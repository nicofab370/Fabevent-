<?php
/**
 * FabEvent — connexion au serveur avec les comptes FabEvent (à déposer à côté de sync.php).
 *
 *   GET  ?action=status&ws=…                       → {ok, session, user?, users, setup: 'open'|'code'|null}
 *   POST ?action=login  {ws, email, password, code?} → session ouverte (cookie) + compte {user}
 *                                                    401 {error:'bad'} · 401 {error:'mfa'} (code MFA demandé) · 429 trop d'essais
 *   POST ?action=setup  {ws, user, code?}           → premier compte administrateur d'une base qui n'en a pas sur le serveur
 *   POST ?action=logout {ws}
 *
 * Aucune dépendance aux pages internes du site : voir _fabevent.php.
 */
ini_set('display_errors', '0');
require __DIR__ . '/_fabevent.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

try { fe_db(); } catch (Throwable $e) { fe_json(500, ['error' => 'storage', 'detail' => 'SQLite indisponible sur l\'hébergement']); }

$action = (string)($_GET['action'] ?? '');
$post = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
$b = [];
if ($post) {
    $raw = (string)file_get_contents('php://input');
    $b = strlen($raw) < 100000 ? (json_decode($raw, true) ?: []) : [];
}
$ws = fe_ws($b['ws'] ?? ($_GET['ws'] ?? ''));
if (!$ws) fe_json(400, ['error' => 'bad_ws']);

/** Ce que l'application garde du compte (pour se connecter aussi hors ligne sur cet appareil). */
function public_user(array $u): array {
    return array_intersect_key($u, array_flip(['id', 'createdAt', 'updatedAt', 'name', 'email', 'salt', 'passHash', 'role', 'personId', 'active', 'totpSecret', 'totpOn', 'oauth']));
}
function active_users(string $ws): array { return array_values(array_filter(fe_users($ws), fn($u) => !empty($u['active']))); }
/** Création du premier compte : libre sur un serveur vierge, sinon code d'installation (ou admin connecté d'une autre base). */
function setup_mode(string $ws): ?string {
    if (active_users($ws)) return null;
    if (!fe_has_data()) return 'open';
    $admin = fe_any_session();
    if ($admin && ($admin['role'] ?? '') === 'admin') return 'open';
    fe_setup_code();
    return 'code';
}

if ($action === 'status') {
    $u = fe_session($ws);
    fe_json(200, ['ok' => true, 'session' => (bool)$u, 'user' => $u ? public_user($u) : null, 'users' => (bool)active_users($ws), 'setup' => setup_mode($ws)]);
}

if ($action === 'login' && $post) {
    if (fe_too_many_fails()) fe_json(429, ['error' => 'too_many', 'detail' => 'Trop d\'essais : réessaie dans 15 minutes.']);
    $email = strtolower(trim((string)($b['email'] ?? '')));
    $pass = (string)($b['password'] ?? '');
    $found = null;
    foreach (active_users($ws) as $u) {
        if (strtolower((string)($u['email'] ?? '')) !== $email || empty($u['passHash'])) continue;
        if (hash_equals((string)$u['passHash'], hash('sha256', (string)($u['salt'] ?? '') . ':' . $pass))) { $found = $u; break; }
    }
    if (!$found) { fe_fail(); fe_json(401, ['error' => 'bad']); }
    if (!empty($found['totpOn']) && !empty($found['totpSecret'])) {
        $code = (string)($b['code'] ?? '');
        if ($code === '') fe_json(401, ['error' => 'mfa']);
        if (!fe_totp_ok((string)$found['totpSecret'], $code)) { fe_fail(); fe_json(401, ['error' => 'mfa_bad']); }
    }
    fe_open_session($ws, $found);
    fe_json(200, ['ok' => true, 'user' => public_user($found)]);
}

if ($action === 'setup' && $post) {
    $mode = setup_mode($ws);
    if ($mode === null) fe_json(409, ['error' => 'exists']);
    if ($mode === 'code') {
        if (fe_too_many_fails()) fe_json(429, ['error' => 'too_many']);
        if (!hash_equals(fe_setup_code(), strtoupper(trim((string)($b['code'] ?? ''))))) { fe_fail(); fe_json(401, ['error' => 'setup_code']); }
    }
    $u = is_array($b['user'] ?? null) ? public_user($b['user']) : [];
    if (!preg_match('/^[A-Za-z0-9_-]{4,64}$/', (string)($u['id'] ?? '')) || !filter_var((string)($u['email'] ?? ''), FILTER_VALIDATE_EMAIL)
        || !preg_match('/^[a-f0-9]{64}$/', (string)($u['passHash'] ?? '')) || (string)($u['salt'] ?? '') === '') fe_json(400, ['error' => 'bad_user']);
    $u['role'] = 'admin';
    $u['active'] = true;
    $u['email'] = strtolower((string)$u['email']);
    $u['updatedAt'] = gmdate('Y-m-d\TH:i:s') . '.000Z';
    fe_db()->prepare('INSERT OR REPLACE INTO changes (space, tbl, id, data, u, who) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([fe_key($ws), 'users', $u['id'], json_encode($u, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $u['updatedAt'], (string)$u['email']]);
    if ($mode === 'code') @unlink(data_dir() . '/code-installation.txt'); // usage unique (un code de fabevent-config.php est à retirer ensuite)
    fe_open_session($ws, $u);
    fe_json(200, ['ok' => true, 'user' => $u]);
}

if ($action === 'logout' && $post) {
    fe_close_session($ws);
    fe_json(200, ['ok' => true]);
}

fe_json(400, ['error' => 'unknown_action']);
