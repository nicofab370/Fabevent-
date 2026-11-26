<?php
/**
 * FabEvent — serveur de synchronisation (à déposer sur l'hébergement, ex. /fabevent/api/sync.php).
 *
 * - Accès : session FabEvent (auth.php, comptes de l'application) sur la base demandée ; rôles admin / entrepôt.
 * - FabEvent est autonome : aucune dépendance aux pages internes du site (voir _fabevent.php).
 * - Stockage : une base SQLite dans un dossier privé (hors du web quand c'est possible).
 * - Chaque enregistrement garde sa dernière version ; en cas de conflit, la plus récente l'emporte.
 *
 * Actions :
 *   POST ?action=push  {ws, changes:[{t, id, d|null, u}]}  → enregistre les modifications d'un appareil
 *   GET  ?action=pull&ws=…&since=N                         → modifications reçues depuis N
 *   POST ?action=next  {ws, key, min}                      → numéro suivant (factures sans doublon)
 *   GET  ?action=ping                                       → vérifie la connexion
 */
ini_set('display_errors', '0');
require __DIR__ . '/_fabevent.php';   // connexion avec les comptes FabEvent (aucune dépendance aux pages internes)

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function out(int $status, array $data): void { fe_json($status, $data); }

const TABLES = ['contacts', 'categories', 'equipment', 'projects', 'subprojects', 'lines', 'people', 'crew', 'vehicles',
    'vehicleAssignments', 'docs', 'settings', 'units', 'repairs', 'inspections', 'subrentals', 'costs', 'unavailability',
    'files', 'transfers', 'appointments', 'checklists', 'crewRequests', 'users'];

function ws_of($v): string {
    $w = fe_ws($v);
    if (!$w) out(400, ['error' => 'bad_ws']);
    return $w;
}

try {
    $db = fe_db();
} catch (Throwable $e) {
    out(500, ['error' => 'storage', 'detail' => 'SQLite indisponible sur l\'hébergement']);
}

// la base demandée (paramètre ws, ou dans le corps JSON) : il faut une session FabEvent sur CETTE base
$rawBody = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' ? (string)file_get_contents('php://input') : '';
$wsReq = $_GET['ws'] ?? ((json_decode($rawBody, true) ?: [])['ws'] ?? '');
$U = fe_require(ws_of($wsReq));
$space = FE_SPACE;

$action = $_GET['action'] ?? '';

if ($action === 'ping') out(200, ['ok' => true, 'user' => (string)($U['email'] ?? ''), 'ws' => (string)$U['ws']]);

function body(): array {
    global $rawBody;
    $raw = $rawBody;
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
            $put->execute([$key, $t, $id, $data, $u, (string)($U['email'] ?? '')]);
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
