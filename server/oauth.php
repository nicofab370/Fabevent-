<?php
/**
 * FabEvent — connexion externe (OAuth 2.0 / OIDC) : Google, Microsoft, Apple.
 *
 * À déployer à côté de sync.php (ex. /fabevent/api/oauth.php). HTTPS obligatoire en production.
 *
 * Configuration par variables d'environnement (fichier .env chargé par l'hébergeur, ou setenv) :
 *   FABEVENT_OAUTH_GOOGLE_CLIENT_ID / FABEVENT_OAUTH_GOOGLE_CLIENT_SECRET
 *   FABEVENT_OAUTH_MICROSOFT_CLIENT_ID / FABEVENT_OAUTH_MICROSOFT_CLIENT_SECRET [/ FABEVENT_OAUTH_MICROSOFT_TENANT=common]
 *   FABEVENT_OAUTH_APPLE_CLIENT_ID (Service ID) / FABEVENT_OAUTH_APPLE_TEAM_ID / FABEVENT_OAUTH_APPLE_KEY_ID
 *       / FABEVENT_OAUTH_APPLE_PRIVATE_KEY (contenu du .p8, ou chemin vers le fichier .p8)
 *   FABEVENT_APP_ORIGIN : origine autorisée de l'application (ex. https://nicofab370.github.io) — sinon l'appli
 *       elle-même (paramètre ?app= de authorize) est utilisée comme cible du postMessage.
 *
 * Actions :
 *   GET  ?action=authorize&provider=google|microsoft|apple&app=<origine app>
 *        → estado + PKCE stockés en SQLite, redirection 302 vers le fournisseur
 *   GET|POST ?action=callback&provider=…  (code, state, [id_token], [user] pour Apple)
 *        → échange du code côté serveur, profil vérifié, code à usage unique émis,
 *          page HTML qui fait window.opener.postMessage({source:'fabevent-oauth', code}, app)
 *   POST ?action=login&code=…  → profil vérifié {ok, profile:{email,name,provider,sub}} (code consommé, 60 s)
 *   GET  ?action=ping → {ok, providers:[…]} (les fournisseurs configurés)
 *
 * Le client (src/oauth.ts) ouvre authorize en popup, reçoit le code par postMessage,
 * puis appelle login pour récupérer le profil et rattacher le compte local par email.
 */
ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

$auth = getenv('FABEVENT_AUTH') ?: __DIR__ . '/../../interne/_lib/auth.php';
if (is_file($auth)) require $auth; // fournit data_dir() (même dossier de données que sync.php)
if (!function_exists('data_dir')) {
    function data_dir(): string {
        $d = getenv('FABEVENT_DATA') ?: __DIR__ . '/data';
        if (!is_dir($d)) @mkdir($d, 0700, true);
        return $d;
    }
}

function out(int $status, array $data): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function html(string $title, string $body): void {
    http_response_code(200);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html><head><meta charset="utf-8"><title>' . htmlspecialchars($title) . '</title></head><body style="font-family:sans-serif;text-align:center;padding:40px">' . $body . '</body></html>';
    exit;
}
function b64url(string $raw): string { return rtrim(strtr(base64_encode($raw), '+/', '-_'), '='); }
function b64url_dec(string $s): string { return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }
function http_post(string $url, array $fields, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($fields),
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => $headers]);
    $r = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'body' => (string)$r, 'json' => json_decode((string)$r, true)];
}
function http_get_json(string $url, array $headers = []): ?array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => $headers]);
    $r = curl_exec($ch);
    curl_close($ch);
    $j = json_decode((string)$r, true);
    return is_array($j) ? $j : null;
}

/* ---------- fournisseurs ---------- */
function providers(): array {
    $self = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . strtok($_SERVER['REQUEST_URI'] ?? '/oauth.php', '?');
    $cb = fn(string $p) => $self . '?action=callback&provider=' . $p;
    $cfg = [];
    if (getenv('FABEVENT_OAUTH_GOOGLE_CLIENT_ID')) {
        $cfg['google'] = [
            'authorize' => 'https://accounts.google.com/o/oauth2/v2/auth',
            'token' => 'https://oauth2.googleapis.com/token',
            'userinfo' => 'https://openidconnect.googleapis.com/v1/userinfo',
            'scope' => 'openid email profile', 'client_id' => getenv('FABEVENT_OAUTH_GOOGLE_CLIENT_ID'),
            'secret' => getenv('FABEVENT_OAUTH_GOOGLE_CLIENT_SECRET') ?: '', 'callback' => $cb('google'), 'form_post' => false,
        ];
    }
    if (getenv('FABEVENT_OAUTH_MICROSOFT_CLIENT_ID')) {
        $tenant = getenv('FABEVENT_OAUTH_MICROSOFT_TENANT') ?: 'common';
        $cfg['microsoft'] = [
            'authorize' => "https://login.microsoftonline.com/$tenant/oauth2/v2.0/authorize",
            'token' => "https://login.microsoftonline.com/$tenant/oauth2/v2.0/token",
            'userinfo' => 'https://graph.microsoft.com/oidc/userinfo',
            'scope' => 'openid email profile', 'client_id' => getenv('FABEVENT_OAUTH_MICROSOFT_CLIENT_ID'),
            'secret' => getenv('FABEVENT_OAUTH_MICROSOFT_CLIENT_SECRET') ?: '', 'callback' => $cb('microsoft'), 'form_post' => false,
        ];
    }
    if (getenv('FABEVENT_OAUTH_APPLE_CLIENT_ID')) {
        $cfg['apple'] = [
            'authorize' => 'https://appleid.apple.com/auth/authorize',
            'token' => 'https://appleid.apple.com/auth/token',
            'userinfo' => null, // Apple ne renvoie le profil que dans l'id_token (et « user » au premier consentement)
            'scope' => 'name email', 'client_id' => getenv('FABEVENT_OAUTH_APPLE_CLIENT_ID'),
            'secret' => '', 'callback' => $cb('apple'), 'form_post' => true,
        ];
    }
    return $cfg;
}

/* ---------- stockage ---------- */
function db(): PDO {
    static $db = null;
    if ($db) return $db;
    $dir = data_dir();
    $db = new PDO('sqlite:' . $dir . '/fabevent-sync.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    $db->exec('CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT NOT NULL, app TEXT NOT NULL, nonce TEXT NOT NULL, exp INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS oauth_codes (code TEXT PRIMARY KEY, provider TEXT NOT NULL, sub TEXT NOT NULL, email TEXT NOT NULL, name TEXT, exp INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS oauth_users (provider TEXT NOT NULL, sub TEXT NOT NULL, email TEXT NOT NULL, name TEXT, PRIMARY KEY(provider, sub))');
    @chmod($dir . '/fabevent-sync.sqlite', 0600);
    return $db;
}

/* ---------- Sign in with Apple : client_secret ES256 + vérification de l'id_token ---------- */
function apple_client_secret(): string {
    $key = getenv('FABEVENT_OAUTH_APPLE_PRIVATE_KEY') ?: '';
    if ($key !== '' && is_file($key)) $key = (string)file_get_contents($key);
    $now = time();
    $jwt = b64url(json_encode(['iss' => getenv('FABEVENT_OAUTH_APPLE_TEAM_ID'), 'iat' => $now, 'exp' => $now + 300,
        'aud' => 'https://appleid.apple.com', 'sub' => getenv('FABEVENT_OAUTH_APPLE_CLIENT_ID')])) . '.' .
        b64url(json_encode(['alg' => 'ES256', 'kid' => getenv('FABEVENT_OAUTH_APPLE_KEY_ID'), 'typ' => 'JWT']));
    $sig = '';
    openssl_sign($jwt, $sig, $key, OPENSSL_ALGO_SHA256);
    return $jwt . '.' . b64url($sig);
}
/** Construit une clé publique RSA PEM à partir de n/e (JWK) pour vérifier un JWT RS256. */
function pem_from_jwk(string $n, string $e): string {
    $der = function (int $len): string { return $len < 128 ? chr($len) : chr(128 + strlen(pack('N', $len))) . pack('N', $len); };
    $int = function (string $bytes): string { return "\x02" . $der(strlen($bytes)) . (ord($bytes[0]) & 0x80 ? "\x00" . $bytes : $bytes); };
    $mod = b64url_dec($n); $exp = b64url_dec($e);
    $rsa = $int($mod) . $int($exp);
    $seq = "\x30" . $der(strlen($rsa)) . $rsa;
    $bit = "\x03" . $der(strlen($seq) + 1) . "\x00" . $seq;
    $alg = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
    $spki = "\x30" . $der(strlen($bit) + strlen($alg)) . $alg . $bit;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64) . "-----END PUBLIC KEY-----\n";
}
function verify_jwt_rs256(string $jwt, string $jwksUrl): ?array {
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) return null;
    $head = json_decode(b64url_dec($parts[0]), true);
    if (!is_array($head) || ($head['alg'] ?? '') !== 'RS256') return null;
    $jwks = http_get_json($jwksUrl);
    if (!$jwks) return null;
    foreach ($jwks['keys'] ?? [] as $k) {
        if (($k['kid'] ?? '') !== ($head['kid'] ?? '')) continue;
        $ok = 0;
        openssl_verify($parts[0] . '.' . $parts[1], b64url_dec($parts[2]), pem_from_jwk($k['n'], $k['e']), OPENSSL_ALGO_SHA256);
        if ($ok === 1) return json_decode(b64url_dec($parts[1]), true);
    }
    return null;
}

/* ---------- actions ---------- */
$action = $_GET['action'] ?? '';
$cfg = providers();

if ($action === 'ping') {
    out(200, ['ok' => true, 'providers' => array_keys($cfg)]);
}

if ($action === 'authorize') {
    $provider = (string)($_GET['provider'] ?? '');
    if (!isset($cfg[$provider])) out(400, ['error' => 'provider_not_configured', 'provider' => $provider]);
    $app = (string)($_GET['app'] ?? '');
    $allow = getenv('FABEVENT_APP_ORIGIN') ?: '';
    if ($app === '' || !preg_match('#^https?://#', $app) || ($allow !== '' && strcasecmp($app, $allow) !== 0)) {
        out(400, ['error' => 'bad_app_origin']);
    }
    $c = $cfg[$provider];
    $state = bin2hex(random_bytes(16));
    $verifier = b64url(random_bytes(32));
    $nonce = bin2hex(random_bytes(16));
    $db = db();
    $db->prepare('INSERT INTO oauth_states (state, provider, verifier, app, nonce, exp) VALUES (?,?,?,?,?,?)')
        ->execute([$state, $provider, $verifier, $app, $nonce, time() + 600]);
    $params = [
        'client_id' => $c['client_id'], 'redirect_uri' => $c['callback'], 'response_type' => 'code',
        'scope' => $c['scope'], 'state' => $state, 'nonce' => $nonce,
        'code_challenge' => b64url(hash('sha256', $verifier, true)), 'code_challenge_method' => 'S256',
    ];
    if ($c['form_post']) { $params['response_mode'] = 'form_post'; }
    http_response_code(302);
    header('Location: ' . $c['authorize'] . '?' . http_build_query($params));
    exit;
}

if ($action === 'callback') {
    $provider = (string)($_GET['provider'] ?? '');
    if (!isset($cfg[$provider])) out(400, ['error' => 'provider_not_configured']);
    $c = $cfg[$provider];
    // Apple renvoie en POST (form_post) ; Google/Microsoft en GET
    $code = (string)($_REQUEST['code'] ?? '');
    $state = (string)($_REQUEST['state'] ?? '');
    $db = db();
    $st = $db->prepare('SELECT * FROM oauth_states WHERE state = ?');
    $st->execute([$state]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row || $row['provider'] !== $provider || (int)$row['exp'] < time() || $code === '') {
        html('Connexion échouée', '<p>Session expirée ou invalide. <a href="javascript:close()">Ferme cette fenêtre</a> et réessaie.</p>');
    }
    $db->prepare('DELETE FROM oauth_states WHERE state = ?')->execute([$state]); // usage unique

    $fields = [
        'grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => $c['callback'],
        'client_id' => $c['client_id'], 'code_verifier' => $row['verifier'],
    ];
    if ($provider === 'apple') { $fields['client_secret'] = apple_client_secret(); }
    else { $fields['client_secret'] = $c['secret']; }
    $tok = http_post($c['token'], $fields);
    if ($tok['code'] !== 200 || !is_array($tok['json']) || empty($tok['json']['access_token']) && empty($tok['json']['id_token'])) {
        html('Connexion échouée', '<p>Échange du code refusé par ' . htmlspecialchars($provider) . '. <a href="javascript:close()">Ferme cette fenêtre</a>.</p>');
    }
    $access = (string)($tok['json']['access_token'] ?? '');
    $idToken = (string)($tok['json']['id_token'] ?? '');

    $sub = ''; $email = ''; $name = ''; $emailVerified = false;
    if ($provider === 'apple') {
        $claims = $idToken !== '' ? verify_jwt_rs256($idToken, 'https://appleid.apple.com/auth/keys') : null;
        if (!$claims) { html('Connexion échouée', '<p>id_token Apple invalide. <a href="javascript:close()">Ferme cette fenêtre</a>.</p>'); }
        if (($claims['nonce'] ?? '') !== $row['nonce']) { html('Connexion échouée', '<p>Nonce invalide. <a href="javascript:close()">Ferme cette fenêtre</a>.</p>'); }
        $sub = (string)($claims['sub'] ?? '');
        $email = (string)($claims['email'] ?? '');
        $emailVerified = (bool)($claims['email_verified'] ?? false);
        $u = json_decode((string)($_POST['user'] ?? ''), true); // présent au premier consentement uniquement
        if (is_array($u)) {
            $name = trim((string)($u['name']['firstName'] ?? '') . ' ' . (string)($u['name']['lastName'] ?? ''));
        }
    } else {
        $ui = $access !== '' ? http_get_json($c['userinfo'], ['Authorization: Bearer ' . $access]) : null;
        if (!$ui) { html('Connexion échouée', '<p>Profil illisible chez ' . htmlspecialchars($provider) . '. <a href="javascript:close()">Ferme cette fenêtre</a>.</p>'); }
        $sub = (string)($ui['sub'] ?? '');
        $email = (string)($ui['email'] ?? '');
        $emailVerified = (bool)($ui['email_verified'] ?? true);
        $name = (string)($ui['name'] ?? '');
        // si un id_token est présent, on vérifie le nonce quand il y est
        if ($idToken !== '') {
            $claims = json_decode(b64url_dec(explode('.', $idToken)[1] ?? ''), true);
            if (is_array($claims) && isset($claims['nonce']) && $claims['nonce'] !== $row['nonce']) {
                html('Connexion échouée', '<p>Nonce invalide. <a href="javascript:close()">Ferme cette fenêtre</a>.</p>');
            }
        }
    }
    if ($sub === '' || $email === '') {
        html('Connexion échouée', '<p>Le fournisseur n’a pas renvoyé d’identifiant ou d’email. <a href="javascript:close()">Ferme cette fenêtre</a>.</p>');
    }
    $email = strtolower(trim($email));

    // compte fournisseur : créé ou mis à jour
    $db->prepare('INSERT OR REPLACE INTO oauth_users (provider, sub, email, name) VALUES (?,?,?,?)')
        ->execute([$provider, $sub, $email, $name]);
    // code à usage unique pour l'application (60 s)
    $one = bin2hex(random_bytes(16));
    $db->prepare('INSERT INTO oauth_codes (code, provider, sub, email, name, exp) VALUES (?,?,?,?,?,?)')
        ->execute([$one, $provider, $sub, $email, $name, time() + 60]);
    $db->exec('DELETE FROM oauth_codes WHERE exp < ' . time()); // ménage

    $app = (string)$row['app'];
    $payload = json_encode(['source' => 'fabevent-oauth', 'code' => $one], JSON_UNESCAPED_SLASHES);
    html('Connexion réussie', '<p>Connexion réussie, tu peux fermer cette fenêtre.</p>'
        . '<script>try{window.opener&&window.opener.postMessage(' . $payload . ',' . json_encode($app) . ')}catch(e){}' .
        'setTimeout(function(){window.close()},400);</script>');
}

if ($action === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $code = (string)($_REQUEST['code'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/', $code)) out(400, ['error' => 'bad_code']);
    $db = db();
    $q = $db->prepare('SELECT * FROM oauth_codes WHERE code = ?');
    $q->execute([$code]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int)$row['exp'] < time()) out(401, ['error' => 'code_expired']);
    $db->prepare('DELETE FROM oauth_codes WHERE code = ?')->execute([$code]); // usage unique
    out(200, ['ok' => true, 'profile' => ['email' => $row['email'], 'name' => $row['name'], 'provider' => $row['provider'], 'sub' => $row['sub']]]);
}

out(400, ['error' => 'unknown_action']);
