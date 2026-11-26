<?php
/**
 * FabEvent — pages publiques pour les techniciens (à déposer à côté de sync.php).
 * Pas de connexion : chaque lien porte une clé secrète, impossible à deviner.
 *
 *   ?r=<jeton>   demande de disponibilité : le technicien répond « disponible / pas disponible » (poste par poste)
 *   ?s=<clé>     formulaire d'inscription : un technicien s'ajoute à ta base (fiche « à valider » dans FabEvent)
 *   ?m=<jeton>   « ma fiche » : un technicien déjà dans ta base met à jour ses coordonnées (modifs « à relire » dans FabEvent)
 *   ?d=<jeton>   devis : le client accepte / refuse en ligne (statut « accepté » = projet confirmé)
 *   ?pw=<jeton>  mot de passe oublié : formulaire de nouveau mot de passe (jeton à usage unique, 2 h,
 *                envoyé par email via POST ?action=reset_request {email} — même config mail que mail.php)
 *
 * Les réponses sont enregistrées dans la base de synchronisation : elles arrivent dans FabEvent toutes seules.
 */
ini_set('display_errors', '0');
require __DIR__ . '/_fabevent.php';   // seulement pour la base de données : aucune connexion n'est demandée ici

header('Content-Type: text/html; charset=utf-8');
set_exception_handler(function (Throwable $e) {
    error_log('FabEvent public.php : ' . $e->getMessage());
    if (!headers_sent()) http_response_code(500);
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Erreur</title>'
        . '<p style="font:16px system-ui;max-width:520px;margin:40px auto;padding:0 16px">Le service est momentanément indisponible. Réessaie dans quelques minutes ou contacte l\'organisateur.</p>';
});
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");

$db = fe_db();

if (!function_exists('h')) { function h($v): string { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); } }
function now_u(): string { $t = microtime(true); return gmdate('Y-m-d\TH:i:s', (int)$t) . sprintf('.%03dZ', (int)(($t - floor($t)) * 1000)); }
function rid(): string { return bin2hex(random_bytes(10)); }
const ICO_CHECK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const ICO_X = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function fdate(string $s): string {
    $t = strtotime($s);
    return $t ? JOURS[(int)date('w', $t)] . ' ' . date('j', $t) . ' ' . MOIS[(int)date('n', $t) - 1] . ' ' . date('Y', $t) . ', ' . date('H:i', $t) : h($s);
}
function page(string $title, string $html, int $status = 200): void {
    http_response_code($status);
    echo '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . h($title) . '</title><style>
      :root{--a:#d97706;--ok:#16a34a;--ko:#dc2626;--b:#e5e7eb;--m:#6b7280}
      body{margin:0;background:#f5f6f8;color:#111827;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      main{max-width:560px;margin:0 auto;padding:20px 16px 40px}h1{font-size:22px;margin:0 0 4px}.m{color:var(--m)}
      .c{background:#fff;border:1px solid var(--b);border-radius:14px;padding:16px;margin:14px 0}
      label{display:block;margin:10px 0 4px;font-weight:600}input,textarea,select{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid var(--b);border-radius:10px;background:#fff}
      textarea{min-height:80px}.row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--b)}.row:first-child{border-top:0}
      .row input{width:22px;height:22px;flex:none;margin-top:2px}.row label{margin:0;font-weight:400}
      .chk{display:flex;gap:8px;align-items:flex-start;font-weight:400}.chk input{width:20px;height:20px;flex:none;margin-top:3px}
      button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:14px 16px;width:100%;margin-top:10px;cursor:pointer;color:#fff;background:var(--a)}
      button.ok{background:var(--ok)}button.ko{background:#fff;color:var(--ko);border:2px solid var(--ko)}
      .msg{padding:12px 14px;border-radius:12px;font-weight:600}.msg.ok{background:#dcfce7;color:#166534}.msg.ko{background:#fee2e2;color:#991b1b}
      .hp{position:absolute;left:-5000px;height:0;overflow:hidden}
    </style></head><body><main>' . $html . '</main></body></html>';
    exit;
}

/** Enregistrement d'une table de synchronisation, retrouvé par une clé contenue dans ses données. */
function find_row(PDO $db, string $tbl, string $field, string $value): ?array {
    $q = $db->prepare("SELECT space, id, data FROM changes WHERE tbl = ? AND data LIKE ? LIMIT 5");
    $q->execute([$tbl, '%"' . $field . '":"' . $value . '"%']);
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $d = json_decode((string)$r['data'], true);
        if (is_array($d) && hash_equals((string)($d[$field] ?? ''), $value)) return ['space' => $r['space'], 'id' => $r['id'], 'data' => $d];
    }
    return null;
}
function put_row(PDO $db, string $space, string $tbl, string $id, array $data): void {
    $u = now_u();
    $data['updatedAt'] = $u;
    $db->prepare('INSERT OR REPLACE INTO changes (space, tbl, id, data, u, who) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$space, $tbl, $id, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $u, 'public']);
}

/* ---------- mot de passe oublié : jetons + envoi d'email (même config que mail.php) ---------- */
$db->exec('CREATE TABLE IF NOT EXISTS reset_tokens (token TEXT PRIMARY KEY, space TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL, created TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0)');

function mail_cfg(): array {
    $f = getenv('FABEVENT_MAIL_CONFIG') ?: __DIR__ . '/mail-config.php';
    $c = is_file($f) ? (require $f) : [];
    return is_array($c) ? $c : [];
}
function smtp_send(array $s, string $from, array $rcpt, string $data): void {
    $host = (string)$s['host']; $port = (int)($s['port'] ?? 587); $secure = (string)($s['secure'] ?? ($port === 465 ? 'ssl' : 'tls'));
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $err, 20, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) throw new RuntimeException("Connexion SMTP impossible ($err)");
    stream_set_timeout($fp, 30);
    $read = function () use ($fp): string { $r = ''; while (($l = fgets($fp, 1024)) !== false) { $r .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; } return $r; };
    $cmd = function (string $c, array $ok) use ($fp, $read): string {
        if ($c !== '') fwrite($fp, $c . "\r\n");
        $r = $read();
        if (!in_array((int)substr($r, 0, 3), $ok, true)) throw new RuntimeException('SMTP : ' . trim(preg_replace('/\s+/', ' ', $r)));
        return $r;
    };
    $cmd('', [220]);
    $ehlo = 'EHLO ' . (gethostname() ?: 'localhost');
    $cmd($ehlo, [250]);
    if ($secure === 'tls') {
        $cmd('STARTTLS', [220]);
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('STARTTLS refusé');
        $cmd($ehlo, [250]);
    }
    if (!empty($s['user'])) {
        $cmd('AUTH LOGIN', [334]);
        $cmd(base64_encode((string)$s['user']), [334]);
        $cmd(base64_encode((string)($s['pass'] ?? '')), [235]);
    }
    $cmd("MAIL FROM:<$from>", [250]);
    foreach ($rcpt as $r) $cmd("RCPT TO:<$r>", [250, 251]);
    $cmd('DATA', [354]);
    fwrite($fp, preg_replace('/^\./m', '..', $data) . "\r\n.\r\n");
    $cmd('', [250]);
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
}
/** Envoie un email texte simple ; ['ok'=>true] ou ['ok'=>false,'error'=>…]. */
function send_mail_simple(string $to, string $subject, string $text): array {
    $cfg = mail_cfg();
    $host = preg_replace('/[^a-z0-9.-]/i', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $from = (string)($cfg['from'] ?? ('noreply@' . preg_replace('/^www\./', '', explode(':', $host)[0])));
    $fromName = (string)($cfg['fromName'] ?? 'FabEvent');
    $outbox = getenv('FABEVENT_MAIL_OUTBOX') ?: ($cfg['outbox'] ?? '');
    $hdr = fn(string $s) => preg_match('/^[\x20-\x7e]*$/', $s) ? $s : '=?UTF-8?B?' . base64_encode($s) . '?=';

    $headers = "From: " . $hdr($fromName) . " <$from>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\nX-Mailer: FabEvent";
    $body = chunk_split(base64_encode(str_replace(["\r\n", "\r"], "\n", $text)));
    try {
        if ($outbox) {
            if (!is_dir($outbox)) @mkdir($outbox, 0700, true);
            $eml = "To: $to\r\nSubject: " . $hdr($subject) . "\r\n" . $headers . "\r\n\r\n" . $body;
            if (@file_put_contents($outbox . '/' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.eml', $eml) === false) return ['ok' => false, 'error' => 'outbox'];
            return ['ok' => true];
        }
        if (!empty($cfg['smtp']['host'])) {
            smtp_send($cfg['smtp'], $from, [$to], "To: $to\r\nSubject: " . $hdr($subject) . "\r\n" . $headers . "\r\n\r\n" . $body);
            return ['ok' => true];
        }
        if (!@mail($to, $hdr($subject), $body, $headers, '-f' . $from)) return ['ok' => false, 'error' => "la fonction mail() de l'hébergement a refusé l'envoi"];
        return ['ok' => true];
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}
$post = $_SERVER['REQUEST_METHOD'] === 'POST';
$self = h(strtok((string)($_SERVER['REQUEST_URI'] ?? ''), '#'));

/* ================= mot de passe oublié ================= */
// POST ?action=reset_request {email} : si un compte actif a cet email, un lien ?pw=… est envoyé par email.
// Réponse identique qu'il existe ou non (on ne révèle pas les emails enregistrés).
if (($_GET['action'] ?? '') === 'reset_request' && $post) {
    header('Content-Type: application/json; charset=utf-8');
    $raw = (string)file_get_contents('php://input');
    $b = json_decode($raw, true);
    $email = strtolower(trim((string)(is_array($b) ? ($b['email'] ?? '') : ($_POST['email'] ?? ''))));
    $out = ['ok' => true];
    if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $q = $db->prepare("SELECT space, id, data FROM changes WHERE tbl = 'users' AND data LIKE ? ORDER BY seq DESC LIMIT 20");
        $q->execute(['%"email":"' . $email . '"%']);
        $found = null;
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $d = json_decode((string)$r['data'], true);
            if (is_array($d) && strtolower((string)($d['email'] ?? '')) === $email && !empty($d['active']) && !empty($d['passHash'])) { $found = ['space' => $r['space'], 'id' => $r['id'], 'data' => $d]; break; }
        }
        if ($found) {
            $db->exec("DELETE FROM reset_tokens WHERE used = 1 OR created < '" . gmdate('Y-m-d\TH:i:s', time() - 7200) . "'");
            $tok = bin2hex(random_bytes(24));
            $db->prepare('INSERT INTO reset_tokens (token, space, user_id, email, created, used) VALUES (?, ?, ?, ?, ?, 0)')
                ->execute([$tok, $found['space'], $found['id'], $email, now_u()]);
            $host = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $base = $scheme . '://' . $host . strtok((string)($_SERVER['REQUEST_URI'] ?? ''), '?');
            $link = $base . '?pw=' . $tok;
            $name = trim((string)($found['data']['name'] ?? ''));
            $text = "Bonjour" . ($name !== '' ? " $name" : '') . ",\n\nTu as demandé à réinitialiser le mot de passe de ton compte FabEvent ($email).\nOuvre ce lien dans les 2 heures (il ne sert qu'une seule fois) :\n$link\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message : ton mot de passe ne change pas.\n\nFabEvent";
            $r = send_mail_simple($email, 'FabEvent — réinitialisation de ton mot de passe', $text);
            if (!$r['ok']) $out = ['ok' => false, 'error' => 'mail_failed', 'detail' => (string)($r['error'] ?? '')];
        }
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
// GET ?pw=<jeton> : formulaire de nouveau mot de passe (POST action=reset_do sur la même URL)
if (isset($_GET['pw'])) {
    $tok = (string)$_GET['pw'];
    if (!preg_match('/^[A-Za-z0-9]{20,64}$/', $tok)) page('Lien invalide', '<h1>Lien invalide</h1><p class="m">Vérifie que le lien est complet.</p>', 404);
    $q = $db->prepare('SELECT * FROM reset_tokens WHERE token = ?');
    $q->execute([$tok]);
    $t = $q->fetch(PDO::FETCH_ASSOC);
    if (!$t || (int)$t['used'] === 1 || strtotime((string)$t['created']) < time() - 7200)
        page('Lien expiré', '<h1>Lien expiré ou déjà utilisé</h1><p class="m">Demande un nouveau lien de réinitialisation depuis l\'écran de connexion de FabEvent.</p>', 404);
    if ($post && ($_POST['action'] ?? '') === 'reset_do') {
        $p1 = (string)($_POST['pass'] ?? '');
        $p2 = (string)($_POST['pass2'] ?? '');
        if (strlen($p1) < 6 || strlen($p1) > 72) page('Mot de passe', '<h1>Mot de passe</h1><div class="c"><div class="msg ko">6 à 72 caractères, s\'il te plaît.</div></div>');
        if ($p1 !== $p2) page('Mot de passe', '<h1>Mot de passe</h1><div class="c"><div class="msg ko">Les deux mots de passe ne correspondent pas.</div></div>');
        $q = $db->prepare("SELECT data FROM changes WHERE tbl = 'users' AND space = ? AND id = ?");
        $q->execute([(string)$t['space'], (string)$t['user_id']]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        $u = $row ? json_decode((string)$row['data'], true) : null;
        if (!is_array($u)) page('Compte introuvable', '<h1>Compte introuvable</h1><p class="m">Ce compte n\'existe plus. Contacte un administrateur.</p>', 404);
        // même hachage que l'application : SHA-256 de « sel:motdepasse »
        $salt = bin2hex(random_bytes(16));
        $u['salt'] = $salt;
        $u['passHash'] = hash('sha256', $salt . ':' . $p1);
        put_row($db, (string)$t['space'], 'users', (string)$t['user_id'], $u);
        $db->prepare('UPDATE reset_tokens SET used = 1 WHERE token = ?')->execute([$tok]);
        page('Mot de passe changé', '<h1>' . ICO_CHECK . 'Mot de passe changé</h1><div class="c"><div class="msg ok">Ton nouveau mot de passe est enregistré ; il arrive sur tes autres appareils à la prochaine synchronisation.</div>'
            . '<p class="m">Connecte-toi dans FabEvent avec ce nouveau mot de passe' . (!empty($u['totpOn']) ? ' (le code de ton application d\'authentification sera aussi demandé)' : '') . '.</p></div>');
    }
    page('Nouveau mot de passe', '<h1>Nouveau mot de passe</h1><div class="c"><form method="post" action="' . $self . '">'
        . '<input type="hidden" name="action" value="reset_do">'
        . '<label for="p1">Nouveau mot de passe (6 caractères min.)</label><input id="p1" name="pass" type="password" minlength="6" maxlength="72" required autocomplete="new-password">'
        . '<label for="p2">Répéter le mot de passe</label><input id="p2" name="pass2" type="password" minlength="6" maxlength="72" required autocomplete="new-password">'
        . '<button>Enregistrer le nouveau mot de passe</button></form></div>'
        . '<p class="m">Ce lien est valable 2 heures et ne sert qu\'une fois. Compte concerné : ' . h((string)$t['email']) . '.</p>');
}

/* ================= demande de disponibilité ================= */
if (isset($_GET['r'])) {
    $tok = (string)$_GET['r'];
    if (!preg_match('/^[A-Za-z0-9]{20,64}$/', $tok)) page('Lien invalide', '<h1>Lien invalide</h1><p class="m">Vérifie que le lien est complet.</p>', 404);
    $row = find_row($db, 'crewRequests', 'token', $tok);
    if (!$row) page('Lien expiré', '<h1>Demande introuvable</h1><p class="m">Cette demande a été retirée. Contacte directement l\'organisateur.</p>', 404);
    $r = $row['data'];
    $posts = is_array($r['posts'] ?? null) ? $r['posts'] : [];
    $who = h(explode(' ', (string)($r['personName'] ?? ''))[0]);
    $head = '<h1>' . h($r['projectName'] ?? 'Projet') . '</h1><div class="m">' . h($r['company'] ?? '') . ($r['venue'] ?? '' ? ' · ' . h($r['venue']) : '') . '</div>';
    if (!empty($r['closed'])) page('Merci', $head . '<div class="c"><div class="msg">Merci ' . $who . ' : ces postes sont déjà pourvus, plus besoin de répondre.</div></div>');

    if ($post) {
        if (!hash_equals((string)$r['token'], (string)($_POST['t'] ?? ''))) page('Erreur', '<h1>Erreur</h1>', 400);
        $yes = ($_POST['answer'] ?? '') === 'oui';
        $picked = array_map('strval', (array)($_POST['p'] ?? []));
        $answers = [];
        foreach ($posts as $p) $answers[(string)$p['crewId']] = $yes && (count($posts) === 1 || in_array((string)$p['crewId'], $picked, true));
        $any = in_array(true, $answers, true);
        $r['answers'] = $answers;
        $r['answer'] = !$any ? 'non' : (in_array(false, $answers, true) ? 'partiel' : 'oui');
        $r['note'] = mb_substr(trim((string)($_POST['note'] ?? '')), 0, 500);
        $r['answeredAt'] = now_u();
        $r['status'] = 'repondu';
        put_row($db, $row['space'], 'crewRequests', $row['id'], $r);
        page('Merci', $head . '<div class="c"><div class="msg ' . ($any ? 'ok' : 'ko') . '">' . ($any ? 'Merci ' . $who . ', ta disponibilité est enregistrée. Tu recevras la confirmation et les détails si tu es retenu(e).' : 'Merci ' . $who . ', c\'est noté : pas disponible.') . '</div>'
            . '<p class="m">Tu peux changer ta réponse avec le même lien tant que les postes ne sont pas pourvus.</p></div>');
    }

    $prev = $r['answers'] ?? [];
    $list = '';
    foreach ($posts as $p) {
        $id = h($p['crewId']);
        $checked = !isset($r['answer']) || !empty($prev[$p['crewId']]) ? ' checked' : '';
        $list .= '<div class="row">' . (count($posts) > 1 ? "<input type=\"checkbox\" name=\"p[]\" value=\"$id\" id=\"p$id\"$checked>" : '')
            . "<label for=\"p$id\"><b>" . h($p['function'] ?? 'Poste') . '</b><br>' . fdate((string)$p['start']) . ' → ' . fdate((string)$p['end'])
            . (!empty($p['place']) ? '<br><span class="m">' . h($p['place']) . '</span>' : '') . '</label></div>';
    }
    $state = isset($r['answer']) ? '<div class="msg ' . ($r['answer'] === 'non' ? 'ko' : 'ok') . '">Ta réponse : ' . ($r['answer'] === 'non' ? 'pas disponible' : ($r['answer'] === 'partiel' ? 'disponible pour une partie des postes' : 'disponible')) . '. Tu peux la changer ci-dessous.</div>' : '';
    page('Disponibilité — ' . ($r['projectName'] ?? ''), $head
        . '<div class="c"><p>Bonjour ' . $who . ',</p>' . (!empty($r['message']) ? '<p style="white-space:pre-wrap">' . h($r['message']) . '</p>' : '<p>Es-tu disponible pour ' . (count($posts) > 1 ? 'ces postes' : 'ce poste') . ' ?</p>') . $state . '</div>'
        . '<form method="post" action="' . $self . '" class="c"><input type="hidden" name="t" value="' . h($tok) . '">'
        . (count($posts) > 1 ? '<p class="m" style="margin-top:0">Décoche les postes où tu n\'es pas disponible.</p>' : '') . $list
        . '<label for="note">Un mot (facultatif)</label><textarea id="note" name="note" maxlength="500" placeholder="ex. dispo seulement à partir de 14 h">' . h($r['note'] ?? '') . '</textarea>'
        . '<button class="ok" name="answer" value="oui">' . ICO_CHECK . 'Je suis disponible</button><button class="ko" name="answer" value="non">' . ICO_X . 'Je ne suis pas disponible</button></form>');
}

/* ================= formulaire d'inscription ================= */
if (isset($_GET['s'])) {
    $key = (string)$_GET['s'];
    if (!preg_match('/^[A-Za-z0-9]{16,64}$/', $key)) page('Lien invalide', '<h1>Lien invalide</h1>', 404);
    $set = find_row($db, 'settings', 'signupKey', $key);
    if (!$set) page('Formulaire fermé', '<h1>Formulaire fermé</h1><p class="m">Ce formulaire n\'est plus actif. Contacte directement l\'organisateur.</p>', 404);
    $s = $set['data'];
    $company = (string)($s['company']['name'] ?? '');
    $functions = array_values(array_filter(array_map(fn($f) => (string)($f['name'] ?? ''), (array)($s['crewFunctions'] ?? []))));
    $head = '<h1>Rejoindre l\'équipe technique</h1><div class="m">' . h($company) . '</div>';
    $err = '';
    if ($post) {
        $f = fn($k, $n = 200) => mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string)($_POST[$k] ?? ''))), 0, $n);
        $name = $f('name', 120); $email = $f('email', 160); $phone = $f('phone', 40);
        if ($f('website') !== '' || (time() - (int)($_POST['ts'] ?? 0)) < 3) page('Merci', $head . '<div class="c"><div class="msg ok">Merci !</div></div>'); // robot
        if ($name === '') $err = 'Indique ton nom.';
        elseif ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) $err = 'Adresse email invalide.';
        elseif ($email === '' && $phone === '') $err = 'Indique au moins un email ou un téléphone.';
        elseif (empty($_POST['consent'])) $err = 'Coche l\'accord sur l\'utilisation de tes données.';
        if (!$err) {
            $skills = array_values(array_intersect($functions, array_map('strval', (array)($_POST['skills'] ?? []))));
            $other = $f('other', 200);
            if ($other !== '') $skills[] = $other;
            $id = rid(); $u = now_u();
            put_row($db, $set['space'], 'people', $id, array_filter([
                'id' => $id, 'createdAt' => $u, 'name' => $name, 'email' => $email ?: null, 'phone' => $phone ?: null, 'city' => $f('city', 80) ?: null,
                'role' => $skills[0] ?? null, 'skills' => $skills, 'dailyRate' => 0, 'costRate' => max(0, (float)str_replace(',', '.', $f('rate', 12))) ?: null,
                'external' => true, 'status' => $f('status', 30) ?: null, 'vatNumber' => $f('vat', 40) ?: null,
                'notes' => $f('notes', 1500) ?: null, 'pending' => true, 'source' => 'formulaire', 'signedUpAt' => $u,
            ], fn($x) => $x !== null));
            page('Merci', $head . '<div class="c"><div class="msg ok">Merci ' . h(explode(' ', $name)[0]) . ', ta fiche est envoyée ! ' . h($company) . ' te recontactera pour les prochains projets.</div></div>');
        }
    }
    $v = fn($k) => h($_POST[$k] ?? '');
    $sk = '';
    foreach ($functions as $i => $fn) $sk .= '<label class="chk"><input type="checkbox" name="skills[]" value="' . h($fn) . '"' . (in_array($fn, (array)($_POST['skills'] ?? []), true) ? ' checked' : '') . '> ' . h($fn) . '</label>';
    page('Inscription — ' . $company, $head . ($err ? '<div class="msg ko" style="margin-top:12px">' . h($err) . '</div>' : '')
        . '<form method="post" action="' . $self . '" class="c"><input type="hidden" name="ts" value="' . time() . '"><div class="hp"><label>Site web <input name="website" tabindex="-1" autocomplete="off"></label></div>'
        . '<label for="name">Nom et prénom *</label><input id="name" name="name" required maxlength="120" autocomplete="name" value="' . $v('name') . '">'
        . '<label for="email">Email</label><input id="email" name="email" type="email" maxlength="160" autocomplete="email" value="' . $v('email') . '">'
        . '<label for="phone">Téléphone</label><input id="phone" name="phone" type="tel" maxlength="40" autocomplete="tel" value="' . $v('phone') . '">'
        . '<label for="city">Ville</label><input id="city" name="city" maxlength="80" autocomplete="address-level2" value="' . $v('city') . '">'
        . ($sk ? '<label>Ce que tu fais</label>' . $sk : '') . '<label for="other">' . ($sk ? 'Autre spécialité' : 'Spécialité (ce que tu fais)') . '</label><input id="other" name="other" maxlength="200" placeholder="ex. technicien vidéo, cariste…" value="' . $v('other') . '">'
        . '<label for="status">Statut</label><select id="status" name="status"><option value="">—</option><option>Indépendant</option><option>Société</option><option>Salarié (intérim, Smart…)</option><option>Bénévole / étudiant</option></select>'
        . '<label for="rate">Tarif journée souhaité (€ HT)</label><input id="rate" name="rate" inputmode="decimal" maxlength="12" value="' . $v('rate') . '">'
        . '<label for="vat">N° TVA / entreprise</label><input id="vat" name="vat" maxlength="40" value="' . $v('vat') . '">'
        . '<label for="notes">Expérience, matériel maîtrisé, permis…</label><textarea id="notes" name="notes" maxlength="1500">' . $v('notes') . '</textarea>'
        . '<label class="chk" style="margin-top:14px"><input type="checkbox" name="consent" value="1" required> J\'accepte que ' . h($company ?: 'l\'organisateur') . ' garde ces informations pour me proposer des missions (je peux demander leur suppression à tout moment).</label>'
        . '<button>Envoyer ma fiche</button></form>');
}

/* ================= « ma fiche » d'un technicien ================= */
if (isset($_GET['m'])) {
    $tok = (string)$_GET['m'];
    if (!preg_match('/^[A-Za-z0-9]{16,64}$/', $tok)) page('Lien invalide', '<h1>Lien invalide</h1><p class="m">Vérifie que le lien est complet.</p>', 404);
    $row = find_row($db, 'people', 'sheetToken', $tok);
    if (!$row) page('Lien invalide', '<h1>Lien invalide</h1><p class="m">Ce lien n\'est pas (ou plus) actif. Demande un nouveau lien à l\'organisateur.</p>', 404);
    $p = $row['data'];
    $set = find_row($db, 'settings', 'id', 'main');
    $sd = $set['data'] ?? [];
    $company = (string)($sd['company']['name'] ?? '');
    $functions = array_values(array_filter(array_map(fn($f) => (string)($f['name'] ?? ''), (array)($sd['crewFunctions'] ?? []))));
    $head = '<h1>Ma fiche</h1><div class="m">' . h((string)($p['name'] ?? '')) . ($company !== '' ? ' · ' . h($company) : '') . '</div>';
    $err = '';
    if ($post) {
        if (!hash_equals((string)$p['sheetToken'], (string)($_POST['t'] ?? ''))) page('Erreur', '<h1>Erreur</h1>', 400);
        $f = fn($k, $n = 200) => mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string)($_POST[$k] ?? ''))), 0, $n);
        if ($f('website') !== '' || (time() - (int)($_POST['ts'] ?? 0)) < 3) page('Merci', $head . '<div class="c"><div class="msg ok">Fiche enregistrée.</div></div>'); // robot
        $name = $f('name', 120); $email = $f('email', 160); $phone = $f('phone', 40);
        if ($name === '') $err = 'Indique ton nom.';
        elseif ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) $err = 'Adresse email invalide.';
        elseif ($email === '' && $phone === '') $err = 'Indique au moins un email ou un téléphone.';
        if (!$err) {
            $skills = array_values(array_intersect($functions, array_map('strval', (array)($_POST['skills'] ?? []))));
            $other = $f('other', 200);
            if ($other !== '') $skills[] = $other;
            $upd = [
                'name' => $name, 'email' => $email ?: null, 'phone' => $phone ?: null, 'city' => $f('city', 80) ?: null,
                'role' => $skills[0] ?? null, 'skills' => $skills, 'status' => $f('status', 30) ?: null, 'vatNumber' => $f('vat', 40) ?: null,
                'costRate' => max(0, (float)str_replace(',', '.', $f('rate', 12))) ?: null, 'notes' => $f('notes', 1500) ?: null,
            ];
            $prev = [];
            foreach ($upd as $k => $nv) { $old = $p[$k] ?? null; if ($old !== $nv) { $prev[$k] = $old; $p[$k] = $nv; } }
            // les changements partent « à relire » dans FabEvent (avec les anciennes valeurs pour pouvoir annuler)
            if ($prev) $p['sheetReview'] = ['at' => now_u(), 'prev' => $prev];
            put_row($db, $row['space'], 'people', $row['id'], $p);
            page('Merci', $head . '<div class="c"><div class="msg ok">Merci ' . h(explode(' ', $name)[0]) . ', ta fiche est enregistrée !' . ($prev ? ' ' . h($company) . ' relit les changements.' : '') . '</div></div>');
        }
    }
    $cur = fn($k) => (string)($_POST[$k] ?? ($p[$k] ?? ''));
    $v = fn($k) => h($cur($k));
    $skillsNow = (array)($_POST['skills'] ?? ($p['skills'] ?? []));
    $sk = '';
    foreach ($functions as $fn) $sk .= '<label class="chk"><input type="checkbox" name="skills[]" value="' . h($fn) . '"' . (in_array($fn, $skillsNow, true) ? ' checked' : '') . '> ' . h($fn) . '</label>';
    $otherNow = implode(', ', array_values(array_diff((array)($p['skills'] ?? []), $functions)));
    $stOpts = '<option value="">—</option>';
    foreach (['Indépendant', 'Société', 'Salarié (intérim, Smart…)', 'Bénévole / étudiant'] as $o)
        $stOpts .= '<option' . ($cur('status') === $o ? ' selected' : '') . '>' . h($o) . '</option>';
    page('Ma fiche — ' . h((string)($p['name'] ?? '')), $head . ($err ? '<div class="msg ko" style="margin-top:12px">' . h($err) . '</div>' : '')
        . '<form method="post" action="' . $self . '" class="c"><input type="hidden" name="t" value="' . h($tok) . '"><input type="hidden" name="ts" value="' . time() . '"><div class="hp"><label>Site web <input name="website" tabindex="-1" autocomplete="off"></label></div>'
        . '<label for="name">Nom et prénom *</label><input id="name" name="name" required maxlength="120" autocomplete="name" value="' . $v('name') . '">'
        . '<label for="email">Email</label><input id="email" name="email" type="email" maxlength="160" autocomplete="email" value="' . $v('email') . '">'
        . '<label for="phone">Téléphone</label><input id="phone" name="phone" type="tel" maxlength="40" autocomplete="tel" value="' . $v('phone') . '">'
        . '<label for="city">Ville</label><input id="city" name="city" maxlength="80" autocomplete="address-level2" value="' . $v('city') . '">'
        . ($sk ? '<label>Ce que tu fais</label>' . $sk : '') . '<label for="other">' . ($sk ? 'Autre spécialité' : 'Spécialité (ce que tu fais)') . '</label><input id="other" name="other" maxlength="200" value="' . h($_POST['other'] ?? $otherNow) . '">'
        . '<label for="status">Statut</label><select id="status" name="status">' . $stOpts . '</select>'
        . '<label for="rate">Tarif journée souhaité (€ HT)</label><input id="rate" name="rate" inputmode="decimal" maxlength="12" value="' . h($_POST['rate'] ?? ($p['costRate'] ?? '')) . '">'
        . '<label for="vat">N° TVA / entreprise</label><input id="vat" name="vat" maxlength="40" value="' . $v('vatNumber') . '">'
        . '<label for="notes">Expérience, matériel maîtrisé, permis…</label><textarea id="notes" name="notes" maxlength="1500">' . $v('notes') . '</textarea>'
        . '<button>Enregistrer ma fiche</button></form>');
}

/* ================= acceptation d'un devis en ligne ================= */
if (isset($_GET['d'])) {
    $tok = (string)$_GET['d'];
    if (!preg_match('/^[A-Za-z0-9]{16,64}$/', $tok)) page('Lien invalide', '<h1>Lien invalide</h1><p class="m">Vérifie que le lien est complet.</p>', 404);
    $row = find_row($db, 'docs', 'publicToken', $tok);
    if (!$row) page('Lien invalide', '<h1>Devis introuvable</h1><p class="m">Ce lien n\'est pas (ou plus) actif. Demande un nouveau lien à l\'organisateur.</p>', 404);
    $d = $row['data'];
    if (($d['type'] ?? '') !== 'devis') page('Lien invalide', '<h1>Ce lien ne concerne pas un devis.</h1>', 404);
    $sn = is_array($d['snapshot'] ?? null) ? $d['snapshot'] : [];
    // ordre des salles choisi dans FabEvent (subOrder) : même ordre ici pour les options
    if (!empty($d['subOrder']) && is_array($d['subOrder']) && is_array($sn['subprojects'] ?? null)) {
        $order = array_values(array_filter(array_map('strval', $d['subOrder'])));
        $subs = $sn['subprojects'];
        usort($subs, function ($a, $b) use ($order) {
            $ka = (string)($a['subId'] ?? $a['name'] ?? '');
            $kb = (string)($b['subId'] ?? $b['name'] ?? '');
            $ia = array_search($ka, $order, true);
            $ib = array_search($kb, $order, true);
            return ($ia === false ? PHP_INT_MAX : $ia) <=> ($ib === false ? PHP_INT_MAX : $ib);
        });
        $sn['subprojects'] = $subs;
    }
    $client = is_array($sn['client'] ?? null) ? (string)($sn['client']['company'] ?? $sn['client']['name'] ?? '') : '';
    $projName = is_array($sn['project'] ?? null) ? (string)($sn['project']['name'] ?? '') : '';
    $head = '<h1>Devis ' . h((string)($d['number'] ?? '')) . '</h1><div class="m">' . h($projName) . ($client !== '' ? ' · ' . h($client) : '') . '</div>';
    // options proposées (hors total), groupées : le client choisit une option par groupe
    $opts = [];
    foreach ((array)($sn['subprojects'] ?? []) as $sp) foreach ((array)($sp['equipment'] ?? []) as $l) if (!empty($l['optional'])) $opts[] = $l;
    $optIds = array_values(array_filter(array_map(fn($l) => (string)($l['optId'] ?? ''), $opts)));
    if (in_array((string)($d['status'] ?? ''), ['accepte', 'refuse'], true))
        page('Devis ' . h((string)($d['number'] ?? '')), $head . '<div class="c"><div class="msg ' . ($d['status'] === 'accepte' ? 'ok' : 'ko') . '">Réponse déjà enregistrée : ' . ($d['status'] === 'accepte' ? 'devis accepté' : 'devis refusé') . '.</div></div>');
    if ($post) {
        if (!hash_equals((string)$d['publicToken'], (string)($_POST['t'] ?? ''))) page('Erreur', '<h1>Erreur</h1>', 400);
        $ans = (string)($_POST['answer'] ?? '');
        if (!in_array($ans, ['accepte', 'refuse'], true)) page('Erreur', '<h1>Erreur</h1>', 400);
        $d['status'] = $ans;
        // options retenues par le client (une par groupe au maximum, validées contre le snapshot)
        $accepted = [];
        if ($ans === 'accepte') foreach ((array)($_POST['opt'] ?? []) as $v) { $v = (string)$v; if ($v !== '' && in_array($v, $optIds, true)) $accepted[] = $v; }
        $d['acceptedOptions'] = $accepted;
        put_row($db, $row['space'], 'docs', $row['id'], $d);
        if ($ans === 'accepte') {
            // devis accepté = projet confirmé (et ses salles non annulées), comme dans FabEvent
            $prow = find_row($db, 'projects', 'id', (string)($d['projectId'] ?? ''));
            if ($prow) {
                $pr = $prow['data'];
                if (in_array((string)($pr['status'] ?? ''), ['demande', 'brouillon', 'option'], true)) {
                    $pr['status'] = 'confirme';
                    $pr['confirmedAt'] = now_u();
                    put_row($db, $prow['space'], 'projects', $prow['id'], $pr);
                }
                $q = $db->prepare("SELECT space, id, data FROM changes WHERE tbl = 'subprojects'");
                $q->execute();
                foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $sr) {
                    $sd = json_decode((string)$sr['data'], true);
                    if (is_array($sd) && (string)($sd['projectId'] ?? '') === (string)$d['projectId']
                        && in_array((string)($sd['status'] ?? ''), ['demande', 'brouillon', 'option'], true)) {
                        $sd['status'] = 'confirme';
                        put_row($db, $sr['space'], 'subprojects', $sr['id'], $sd);
                    }
                }
            }
        }
        $extra = 0; foreach ($opts as $l) if (in_array((string)($l['optId'] ?? ''), $accepted, true)) $extra += (float)($l['total'] ?? 0);
        $ttcAll = number_format((float)($sn['totalTTC'] ?? 0) + $extra * (1 + (float)($sn['vatRate'] ?? 0) / 100), 2, ',', ' ') . ' € TTC';
        page('Merci', $head . '<div class="c"><div class="msg ' . ($ans === 'accepte' ? 'ok' : 'ko') . '">'
            . ($ans === 'accepte'
                ? 'Merci ! Le devis est accepté' . ($accepted ? ' avec ' . count($accepted) . ' option(s) — total ' . $ttcAll : '') . ' : le projet est confirmé et le matériel réservé.'
                : 'Devis refusé, c\'est noté. N\'hésite pas à nous contacter si tu as des questions.')
            . '</div></div>');
    }
    $ttc = number_format((float)($sn['totalTTC'] ?? 0), 2, ',', ' ') . ' € TTC';
    $dates = !empty($sn['project']['start']) ? fdate((string)$sn['project']['start']) . ' → ' . fdate((string)($sn['project']['end'] ?? $sn['project']['start'])) : '';
    $valid = !empty($sn['validUntil']) ? fdate((string)$sn['validUntil']) : '';
    // formulaire des options : un choix (radio) par groupe d'options
    $optHtml = '';
    if ($opts) {
        $rate = (float)($sn['vatRate'] ?? 0);
        $groups = [];
        foreach ($opts as $l) $groups[(string)($l['optionGroup'] ?? '')][] = $l;
        $optHtml = '<p style="margin:0 0 6px"><b>Options proposées (hors total)</b> — choisis dans chaque groupe :</p>';
        foreach ($groups as $g => $ls) {
            $gid = 'g' . substr(md5($g), 0, 8);
            $optHtml .= '<p style="margin:10px 0 4px"><b>' . h($g !== '' ? 'Groupe « ' . $g . ' »' : 'Autres options') . '</b></p>';
            $optHtml .= '<div class="row"><input type="radio" name="opt[' . $gid . ']" value="" id="' . $gid . 'x" checked><label for="' . $gid . 'x">Aucune</label></div>';
            foreach ($ls as $l) {
                $id = h((string)($l['optId'] ?? ''));
                $ttcL = number_format((float)($l['total'] ?? 0) * (1 + $rate / 100), 2, ',', ' ') . ' € TTC';
                $optHtml .= '<div class="row"><input type="radio" name="opt[' . $gid . ']" value="' . $id . '" id="' . $gid . '-' . $id . '"><label for="' . $gid . '-' . $id . '"><b>' . h((string)($l['name'] ?? '')) . '</b> × ' . h((string)($l['qty'] ?? 1)) . ' — ' . $ttcL . '</label></div>';
            }
        }
    }
    page('Devis ' . h((string)($d['number'] ?? '')), $head
        . '<div class="c"><p><b>' . h($projName) . '</b>' . ($dates !== '' ? '<br><span class="m">' . $dates . '</span>' : '') . '</p>'
        . '<p>Montant : <b>' . $ttc . '</b>' . ($valid !== '' ? '<br><span class="m">valable jusqu\'au ' . $valid . '</span>' : '')
        . ($opts ? '<br><span class="m">' . count($opts) . ' option(s) proposée(s) au choix, hors total.</span>' : '') . '</p>'
        . (!empty($sn['note']) ? '<p style="white-space:pre-wrap" class="m">' . h((string)$sn['note']) . '</p>' : '')
        . '</div>'
        . '<form method="post" action="' . $self . '" class="c"><input type="hidden" name="t" value="' . h($tok) . '">'
        . ($optHtml ? '<div class="c" style="margin-top:0">' . $optHtml . '</div>' : '')
        . '<button class="ok" name="answer" value="accepte">' . ICO_CHECK . 'J\'accepte ce devis</button>'
        . '<button class="ko" name="answer" value="refuse">' . ICO_X . 'Je refuse ce devis</button></form>');
}

page('FabEvent', '<h1>Lien incomplet</h1><p class="m">Utilise le lien reçu par email.</p>', 404);
