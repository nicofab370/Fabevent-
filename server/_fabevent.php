<?php
/**
 * FabEvent — bibliothèque commune des scripts serveur (sync.php, mail.php, public.php, oauth.php, auth.php).
 *
 * FabEvent est AUTONOME : aucune dépendance aux pages internes du site. La connexion se fait avec les
 * comptes FabEvent eux-mêmes (ceux de l'écran de connexion de l'application, table « users » synchronisée) :
 *   - mot de passe vérifié ici (même hachage que l'application : SHA-256 de « sel:motdepasse ») ;
 *   - code MFA (TOTP) exigé si le compte l'a activé ;
 *   - session = cookie « fe_<base> » (HttpOnly, limité au dossier de FabEvent), 60 jours, prolongé à l'usage ;
 *   - un changement de mot de passe ou la désactivation du compte ferme ses sessions.
 *
 * Données : une base SQLite dans un dossier privé, hors du web si possible :
 *   1. variable d'environnement FABEVENT_DATA (tests) ;
 *   2. 'data_dir' de fabevent-config.php (à côté de ce fichier, facultatif) ;
 *   3. <dossier parent du site>/fabevent-prive (hors du web) ;
 *   4. sinon api/_donnees (protégé par .htaccess).
 */
if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === realpath(__FILE__)) { http_response_code(404); exit; }

const FE_SESSION_DAYS = 60;
const FE_SPACE = 'commun';            // espace des données (le même qu'avant : rien n'est déplacé)
const FE_STAFF = ['admin', 'warehouse']; // rôles qui synchronisent (un sous-traitant ne reçoit pas toute la base)

function fe_config(): array {
    static $c = null;
    if ($c !== null) return $c;
    $f = getenv('FABEVENT_CONFIG') ?: __DIR__ . '/fabevent-config.php';
    $v = is_file($f) ? (require $f) : [];
    return $c = is_array($v) ? $v : [];
}

function fe_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function fe_protect(string $dir): void {
    if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    if (!is_file($dir . '/index.html')) @file_put_contents($dir . '/index.html', '');
}

/** Dossier privé des données de FabEvent (créé au besoin). */
function data_dir(): string {
    static $d = null;
    if ($d !== null) return $d;
    $env = getenv('FABEVENT_DATA');
    if ($env) { if (!is_dir($env)) @mkdir($env, 0700, true); return $d = $env; }
    $cfg = (string)(fe_config()['data_dir'] ?? '');
    if ($cfg !== '') { if (!is_dir($cfg)) @mkdir($cfg, 0700, true); return $d = $cfg; }
    $root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    if ($root !== '') {
        $out = dirname($root) . '/fabevent-prive';
        if (is_dir($out) || (is_writable(dirname($root)) && @mkdir($out, 0700, true))) {
            if (is_writable($out)) return $d = $out;
        }
    }
    $in = __DIR__ . '/_donnees';
    if (!is_dir($in)) @mkdir($in, 0700, true);
    fe_protect($in);
    return $d = $in;
}

/**
 * Première ouverture du nouveau dossier : reprise UNE fois de la base de synchro existante
 * (ancien emplacement : dossier privé des pages internes). Simple copie de fichier, aucune dépendance ensuite.
 */
function fe_migrate(string $file): void {
    if (is_file($file) || getenv('FABEVENT_DATA')) return;
    $root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    $old = [];
    foreach ((array)(fe_config()['old_data_files'] ?? []) as $f) $old[] = (string)$f;
    if ($root !== '') { $old[] = dirname($root) . '/fabri-prive/fabevent-sync.sqlite'; $old[] = $root . '/interne/_data/fabevent-sync.sqlite'; }
    foreach ($old as $f) {
        if (!is_file($f)) continue;
        try {
            // VACUUM INTO : copie cohérente, journal WAL compris
            $src = new PDO('sqlite:' . $f, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $src->exec('VACUUM INTO ' . $src->quote($file));
        } catch (Throwable $e) {
            @copy($f, $file);
        }
        if (is_file($file)) { @chmod($file, 0600); @file_put_contents(dirname($file) . '/reprise.txt', 'Base reprise de ' . $f . ' le ' . gmdate('c') . "\n"); }
        return;
    }
}

/** Base SQLite de FabEvent (tables créées au besoin). */
function fe_db(): PDO {
    static $db = null;
    if ($db) return $db;
    $file = data_dir() . '/fabevent-sync.sqlite';
    fe_migrate($file);
    $db = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    $db->exec('CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, space TEXT NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL,
        data TEXT, u TEXT NOT NULL, who TEXT, UNIQUE(space, tbl, id))');
    $db->exec('CREATE INDEX IF NOT EXISTS changes_space_seq ON changes(space, seq)');
    $db->exec('CREATE TABLE IF NOT EXISTS counters (space TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(space, k))');
    $db->exec('CREATE TABLE IF NOT EXISTS sessions (h TEXT PRIMARY KEY, ws TEXT NOT NULL, uid TEXT NOT NULL, pv TEXT NOT NULL, exp INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS login_fails (ip TEXT NOT NULL, t INTEGER NOT NULL)');
    @chmod($file, 0600);
    return $db;
}

function fe_ws($v): ?string {
    $w = (string)$v;
    return preg_match('/^[a-z0-9_-]{1,40}$/i', $w) ? $w : null;
}
/** Clé d'espace d'une base dans la table changes. */
function fe_key(string $ws): string { return FE_SPACE . '/' . $ws; }

/** Comptes FabEvent d'une base (enregistrements de la table users). */
function fe_users(string $ws): array {
    $q = fe_db()->prepare("SELECT data FROM changes WHERE space = ? AND tbl = 'users' AND data IS NOT NULL");
    $q->execute([fe_key($ws)]);
    $out = [];
    foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $raw) { $u = json_decode((string)$raw, true); if (is_array($u) && !empty($u['id'])) $out[] = $u; }
    return $out;
}
function fe_user_by_id(string $ws, string $id): ?array {
    $q = fe_db()->prepare("SELECT data FROM changes WHERE space = ? AND tbl = 'users' AND id = ?");
    $q->execute([fe_key($ws), $id]);
    $u = json_decode((string)($q->fetchColumn() ?: ''), true);
    return is_array($u) ? $u : null;
}
/** Empreinte du mot de passe : si elle change, les sessions du compte sont fermées. */
function fe_pv(array $u): string { return substr((string)($u['passHash'] ?? ''), 0, 16); }

function fe_cookie_name(string $ws): string { return 'fe_' . $ws; }
/** Chemin du cookie : le dossier de l'application (ex. /fabevent/), jamais tout le site. */
function fe_cookie_path(): string {
    $p = str_replace('\\', '/', dirname(dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api/x.php'))));
    return rtrim($p, '/') . '/';
}
function fe_set_cookie(string $ws, string $val, int $exp): void {
    setcookie(fe_cookie_name($ws), $val, ['expires' => $exp, 'path' => fe_cookie_path(), 'secure' => fe_https(), 'httponly' => true, 'samesite' => 'Lax']);
}

/** Ouvre une session pour ce compte (cookie). */
function fe_open_session(string $ws, array $u): void {
    $tok = bin2hex(random_bytes(32));
    $exp = time() + FE_SESSION_DAYS * 86400;
    $db = fe_db();
    $db->prepare('DELETE FROM sessions WHERE exp < ?')->execute([time()]);
    $db->prepare('INSERT INTO sessions (h, ws, uid, pv, exp) VALUES (?, ?, ?, ?, ?)')->execute([hash('sha256', $tok), $ws, (string)$u['id'], fe_pv($u), $exp]);
    fe_set_cookie($ws, $tok, $exp);
    $_COOKIE[fe_cookie_name($ws)] = $tok;
}
function fe_close_session(string $ws): void {
    $tok = (string)($_COOKIE[fe_cookie_name($ws)] ?? '');
    if ($tok !== '') fe_db()->prepare('DELETE FROM sessions WHERE h = ?')->execute([hash('sha256', $tok)]);
    fe_set_cookie($ws, '', time() - 3600);
}

/** Compte connecté sur cette base, ou null. La session est prolongée à l'usage (une fois par jour). */
function fe_session(string $ws): ?array {
    $tok = (string)($_COOKIE[fe_cookie_name($ws)] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $tok)) return null;
    $db = fe_db();
    $h = hash('sha256', $tok);
    $q = $db->prepare('SELECT * FROM sessions WHERE h = ? AND ws = ?');
    $q->execute([$h, $ws]);
    $s = $q->fetch(PDO::FETCH_ASSOC);
    if (!$s || (int)$s['exp'] < time()) return null;
    $u = fe_user_by_id($ws, (string)$s['uid']);
    if (!$u || empty($u['active']) || fe_pv($u) !== (string)$s['pv']) {
        $db->prepare('DELETE FROM sessions WHERE h = ?')->execute([$h]);
        return null;
    }
    if ((int)$s['exp'] < time() + (FE_SESSION_DAYS - 1) * 86400) {
        $exp = time() + FE_SESSION_DAYS * 86400;
        $db->prepare('UPDATE sessions SET exp = ? WHERE h = ?')->execute([$exp, $h]);
        fe_set_cookie($ws, $tok, $exp);
    }
    return $u + ['ws' => $ws];
}

/** Toutes les bases où ce navigateur a une session (cookies fe_*). */
function fe_any_session(): ?array {
    foreach ($_COOKIE as $k => $v) {
        if (strncmp((string)$k, 'fe_', 3) !== 0) continue;
        $ws = fe_ws(substr((string)$k, 3));
        if ($ws && ($u = fe_session($ws)) && in_array((string)($u['role'] ?? ''), FE_STAFF, true)) return $u;
    }
    return null;
}

function fe_json(int $status, array $data): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** API : compte connecté (personnel : admin ou entrepôt) sur cette base, sinon 401 / 403 en JSON. */
function fe_require(?string $ws): array {
    $u = $ws ? fe_session($ws) : fe_any_session();
    if (!$u) fe_json(401, ['error' => 'auth']);
    if (!in_array((string)($u['role'] ?? ''), FE_STAFF, true)) fe_json(403, ['error' => 'role']);
    return $u;
}

/* ---------- MFA (TOTP, RFC 6238 : HMAC-SHA-1, 30 s, 6 chiffres — comme src/totp.ts) ---------- */
function fe_b32(string $s): string {
    $abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $s = strtoupper(preg_replace('/[^A-Z2-7]/i', '', $s));
    $bits = ''; $out = '';
    for ($i = 0; $i < strlen($s); $i++) $bits .= str_pad(decbin(strpos($abc, $s[$i])), 5, '0', STR_PAD_LEFT);
    for ($i = 0; $i + 8 <= strlen($bits); $i += 8) $out .= chr(bindec(substr($bits, $i, 8)));
    return $out;
}
function fe_totp_ok(string $secret, string $code): bool {
    $code = preg_replace('/\s/', '', $code);
    if (!preg_match('/^\d{6}$/', $code)) return false;
    $key = fe_b32($secret);
    $t = (int)floor(time() / 30);
    for ($w = -1; $w <= 1; $w++) {
        $h = hash_hmac('sha1', pack('J', $t + $w), $key, true);
        $o = ord($h[19]) & 15;
        $n = ((ord($h[$o]) & 127) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
        if (hash_equals(str_pad((string)($n % 1000000), 6, '0', STR_PAD_LEFT), $code)) return true;
    }
    return false;
}

/* ---------- limite des essais ratés (par adresse IP) ---------- */
function fe_ip(): string { return hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? '')); }
function fe_too_many_fails(): bool {
    $q = fe_db()->prepare('SELECT COUNT(*) FROM login_fails WHERE ip = ? AND t > ?');
    $q->execute([fe_ip(), time() - 900]);
    return (int)$q->fetchColumn() >= 10;
}
function fe_fail(): void {
    $db = fe_db();
    $db->prepare('DELETE FROM login_fails WHERE t < ?')->execute([time() - 3600]);
    $db->prepare('INSERT INTO login_fails (ip, t) VALUES (?, ?)')->execute([fe_ip(), time()]);
}

/* ---------- première installation ---------- */
/** Code d'installation (fichier dans le dossier privé, à lire par FTP) : exigé pour créer le premier compte d'un serveur qui a déjà des données. */
function fe_setup_code(): string {
    // code choisi dans fabevent-config.php (dossier api/, accessible par FTP) : 'setup_code' => '…' (8 caractères min.)
    $own = strtoupper(trim((string)(fe_config()['setup_code'] ?? '')));
    if (strlen($own) >= 8) return $own;
    $f = data_dir() . '/code-installation.txt';
    $c = is_file($f) ? trim((string)file_get_contents($f)) : '';
    if (!preg_match('/^[A-Z0-9]{10}$/', $c)) {
        $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; $c = '';
        for ($i = 0; $i < 10; $i++) $c .= $abc[random_int(0, strlen($abc) - 1)];
        @file_put_contents($f, $c . "\n");
        @chmod($f, 0600);
    }
    return $c;
}
/** Le serveur a-t-il déjà des données (n'importe quelle base) ? */
function fe_has_data(): bool {
    return (bool)fe_db()->query('SELECT 1 FROM changes LIMIT 1')->fetchColumn();
}

/**
 * Nouveau mot de passe pour tous les comptes actifs de cet email, dans toutes les bases (une même personne
 * peut avoir un compte dans « principal » et dans une base de société). Même hachage que l'application.
 * Renvoie le nombre de comptes modifiés. Les sessions ouvertes avec l'ancien mot de passe sont fermées.
 */
function fe_set_password(string $email, string $pass): int {
    $email = strtolower(trim($email));
    if ($email === '') return 0;
    $db = fe_db();
    $q = $db->prepare("SELECT space, id, data FROM changes WHERE tbl = 'users' AND data LIKE ?");
    $q->execute(['%' . $email . '%']); // filtre large ; l'email exact est vérifié ci-dessous
    $put = $db->prepare('INSERT OR REPLACE INTO changes (space, tbl, id, data, u, who) VALUES (?, ?, ?, ?, ?, ?)');
    $n = 0;
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $u = json_decode((string)$r['data'], true);
        if (!is_array($u) || strtolower((string)($u['email'] ?? '')) !== $email || empty($u['active'])) continue;
        $u['salt'] = bin2hex(random_bytes(16));
        $u['passHash'] = hash('sha256', $u['salt'] . ':' . $pass);
        $t = microtime(true);
        $u['updatedAt'] = gmdate('Y-m-d\TH:i:s', (int)$t) . sprintf('.%03dZ', (int)(($t - floor($t)) * 1000));
        $put->execute([$r['space'], 'users', $r['id'], json_encode($u, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $u['updatedAt'], 'mot-de-passe']);
        $n++;
    }
    return $n;
}
