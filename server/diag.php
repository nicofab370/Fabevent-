<?php
/**
 * FabEvent — diagnostic de l'API (à déposer dans api/, à côté de sync.php).
 *
 * Ouvrir https://<hote>/fabevent/api/diag.php dans un navigateur : doit répondre en JSON.
 * - Si la page de l'application (HTML) s'affiche à la place : le dossier api/ n'est pas atteint
 *   par le serveur (réécriture SPA / ErrorDocument 404) — voir docs/deploiement-fabri.md.
 * - Sinon le JSON liste les fichiers vus dans api/, les extensions PHP, le dossier de données et les bases.
 */
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

$ext = [];
foreach (['pdo_sqlite', 'sqlite3', 'curl', 'openssl', 'mbstring', 'json', 'session', 'filter'] as $e) $ext[$e] = extension_loaded($e);

$out = [
    'ok' => true,
    'php' => PHP_VERSION,
    'sapi' => php_sapi_name(),
    'script' => __FILE__,
    'docroot' => $_SERVER['DOCUMENT_ROOT'] ?? null,
    'uri' => $_SERVER['REQUEST_URI'] ?? null,
    'extensions' => $ext,
    'lib' => is_file(__DIR__ . '/_fabevent.php') ? 'trouvée (_fabevent.php)' : 'ABSENTE : déposer _fabevent.php à côté de ce fichier',
    'api_dir' => array_values(array_filter(scandir(__DIR__) ?: [], fn($f) => $f[0] !== '.')),
    'data_dir' => null,
    'data_writable' => null,
];
if (is_file(__DIR__ . '/_fabevent.php')) {
    try {
        require __DIR__ . '/_fabevent.php';
        $d = data_dir();
        $out['data_dir'] = $d;
        $out['data_writable'] = is_writable($d);
        $db = fe_db();
        $out['reprise_ancienne_base'] = is_file($d . '/reprise.txt') ? trim((string)file_get_contents($d . '/reprise.txt')) : 'non (base neuve ou déjà à cet endroit)';
        // par base : nombre d'enregistrements et de comptes actifs (aucune donnée personnelle)
        $bases = [];
        foreach ($db->query("SELECT space, COUNT(*) n, SUM(CASE WHEN tbl = 'users' AND data LIKE '%\"active\":true%' THEN 1 ELSE 0 END) a FROM changes GROUP BY space")->fetchAll(PDO::FETCH_ASSOC) as $r)
            $bases[$r['space']] = ['enregistrements' => (int)$r['n'], 'comptes_actifs' => (int)$r['a']];
        $out['bases'] = $bases;
        $out['installation'] = is_file($d . '/code-installation.txt') ? 'code d\'installation en attente (fichier code-installation.txt du dossier de données)' : null;
    } catch (Throwable $e) {
        $out['erreur'] = $e->getMessage();
    }
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
