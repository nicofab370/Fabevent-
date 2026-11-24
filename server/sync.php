<?php
/**
 * FabEvent — serveur de synchronisation (à déposer sur l'hébergement, ex. /fabevent/api/sync.php).
 *
 * - Accès : il faut être connecté aux pages internes FABRI.live (interne/login.php), comme la Checklist.
 * - Les comptes qui ont accès au Rentman commun partagent le même espace ; les autres ont chacun le leur.
 * - Stockage : une base SQLite dans le dossier privé des pages internes (hors du web quand c'est possible).
 * - Chaque enregistrement garde sa dernière version ; en cas de conflit, la plus récente l'emporte.
 *
 * Actions :
 *   POST ?action=push  {ws, changes:[{t, id, d|null, u}]}  → enregistre les modifications d'un appareil
 *   GET  ?action=pull&ws=…&since=N                         → modifications reçues depuis N
 *   POST ?action=next  {ws, key, min}                      → numéro suivant (factures sans doublon)
 *   GET  ?action=ping                                       → vérifie la connexion
 */
ini_set('display_errors', '0');

// bibliothèque de connexion des pages internes (chemin à adapter si FabEvent n'est pas dans /fabevent/)
$auth = getenv('FABEVENT_AUTH') ?: __DIR__ . '/../../interne/_lib/auth.php';
if (!is_file($auth)) { http_response_code(503); header('Content-Type: application/json'); echo '{"error":"auth_lib"}'; exit; }
require $auth;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function out(int $status, array $data): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$U = api_user();                 // 401 si personne n'est connecté
session_write_close();
$space = can_use_shared($U) ? 'commun' : 'u-' . preg_replace('/[^a-z0-9_-]/i', '', (string)($U['login'] ?? 'x'));

const TABLES = ['contacts', 'categories', 'equipment', 'projects', 'subprojects', 'lines', 'people', 'crew', 'vehicles',
    'vehicleAssignments', 'docs', 'settings', 'units', 'repairs', 'inspections', 'subrentals', 'costs', 'unavailability',
    'files', 'transfers', 'appointments', 'checklists', 'crewRequests', 'users'];

function ws_of($v): string {
    $w = (string)$v;
    if (!preg_match('/^[a-z0-9_-]{1,40}$/i', $w)) out(400, ['error' => 'bad_ws']);
    return $w;
}

$dir = data_dir();
try {
    $db = new PDO('sqlite:' . $dir . '/fabevent-sync.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    $db->exec('CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, space TEXT NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL,
        data TEXT, u TEXT NOT NULL, who TEXT, UNIQUE(space, tbl, id))');
    $db->exec('CREATE INDEX IF NOT EXISTS changes_space_seq ON changes(space, seq)');
    $db->exec('CREATE TABLE IF NOT EXISTS counters (space TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(space, k))');
} catch (Throwable $e) {
    out(500, ['error' => 'storage', 'detail' => 'SQLite indisponible sur l\'hébergement']);
}
@chmod($dir . '/fabevent-sync.sqlite', 0600);

$action = $_GET['action'] ?? '';

if ($action === 'ping') out(200, ['ok' => true, 'user' => (string)($U['login'] ?? ''), 'space' => $space]);

function body(): array {
    $raw = (string)file_get_contents('php://input');
    if (strlen($raw) > 40 * 1024 * 1024) out(413, ['error' => 'too_big']);
    $j = json_decode($raw, true);
    if (!is_array($j)) out(400, ['error' => 'bad_request']);
    return $j;
}

if ($action === 'push' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $b = body();
    $key = $space . '/' . ws_of($b['ws'] ?? '');
    $changes = is_array($b['changes'] ?? null) ? array_slice($b['changes'], 0, 500) : [];
    $get = $db->prepare('SELECT u FROM changes WHERE space = ? AND tbl = ? AND id = ?');
    $put = $db->prepare('INSERT OR REPLACE INTO changes (space, tbl, id, data, u, who) VALUES (?, ?, ?, ?, ?, ?)');
    $applied = 0; $skipped = 0;
    $db->exec('BEGIN IMMEDIATE');
    try {
        foreach ($changes as $c) {
            $t = (string)($c['t'] ?? ''); $id = (string)($c['id'] ?? ''); $u = (string)($c['u'] ?? '');
            if (!in_array($t, TABLES, true) || $id === '' || strlen($id) > 100 || $u === '' || strlen($u) > 40) continue;
            $get->execute([$key, $t, $id]);
            $old = $get->fetchColumn();
            // la version la plus récente l'emporte
            if ($old !== false && strcmp((string)$old, $u) > 0) { $skipped++; continue; }
            $data = array_key_exists('d', $c) && $c['d'] !== null ? json_encode($c['d'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
            $put->execute([$key, $t, $id, $data, $u, (string)($U['login'] ?? '')]);
            $applied++;
        }
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        out(500, ['error' => 'write']);
    }
    out(200, ['ok' => true, 'applied' => $applied, 'skipped' => $skipped]);
}

if ($action === 'pull') {
    $key = $space . '/' . ws_of($_GET['ws'] ?? '');
    $since = max(0, (int)($_GET['since'] ?? 0));
    $limit = 1000;
    $q = $db->prepare('SELECT seq, tbl, id, data, u FROM changes WHERE space = ? AND seq > ? ORDER BY seq LIMIT ' . $limit);
    $q->execute([$key, $since]);
    $rows = $q->fetchAll(PDO::FETCH_ASSOC);
    $seq = $since;
    $changes = [];
    foreach ($rows as $r) {
        $seq = (int)$r['seq'];
        $changes[] = ['t' => $r['tbl'], 'id' => $r['id'], 'd' => $r['data'] === null ? null : json_decode($r['data'], true), 'u' => $r['u']];
    }
    out(200, ['changes' => $changes, 'seq' => $seq, 'more' => count($rows) === $limit]);
}

if ($action === 'next' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $b = body();
    $space_ws = $space . '/' . ws_of($b['ws'] ?? '');
    $k = (string)($b['key'] ?? '');
    if (!preg_match('/^[A-Z]{1,3}-\d{4}$/', $k)) out(400, ['error' => 'bad_key']);
    $min = max(1, (int)($b['min'] ?? 1));
    $db->exec('BEGIN IMMEDIATE');
    $g = $db->prepare('SELECT n FROM counters WHERE space = ? AND k = ?');
    $g->execute([$space_ws, $k]);
    $cur = (int)($g->fetchColumn() ?: 0);
    $n = max($cur + 1, $min);
    $db->prepare('INSERT OR REPLACE INTO counters (space, k, n) VALUES (?, ?, ?)')->execute([$space_ws, $k, $n]);
    $db->exec('COMMIT');
    out(200, ['n' => $n]);
}

out(400, ['error' => 'unknown_action']);
