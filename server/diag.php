<?php
/**
 * FabEvent — diagnostic de l'API (à déposer dans api/, à côté de sync.php).
 *
 * Ouvrir https://<hote>/fabevent/api/diag.php dans un navigateur : doit répondre en JSON.
 * - Si la page de l'application (HTML) s'affiche à la place : le dossier api/ n'est pas atteint
 *   par le serveur (réécriture SPA / ErrorDocument 404) — voir docs/deploiement-fabri.md.
 * - Sinon le JSON liste les fichiers vus dans api/, les extensions PHP et la bibliothèque d'auth.
 */
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

$ext = [];
foreach (['pdo_sqlite', 'sqlite3', 'curl', 'openssl', 'mbstring', 'json', 'session', 'filter'] as $e) $ext[$e] = extension_loaded($e);

$authPath = __DIR__ . '/../../interne/_lib/auth.php';
$out = [
    'ok' => true,
    'php' => PHP_VERSION,
    'sapi' => php_sapi_name(),
    'script' => __FILE__,
    'docroot' => $_SERVER['DOCUMENT_ROOT'] ?? null,
    'uri' => $_SERVER['REQUEST_URI'] ?? null,
    'extensions' => $ext,
    'auth_lib' => is_file($authPath) ? ('trouvée : ' . realpath($authPath)) : ('ABSENTE : ' . $authPath),
    'api_dir' => array_values(array_filter(scandir(__DIR__) ?: [], fn($f) => $f[0] !== '.')),
    'data_dir' => null,
    'data_writable' => null,
];
if (is_file($authPath)) {
    try {
        require $authPath;
        $out['auth_lib'] .= function_exists('api_user') && function_exists('data_dir') ? ' (api_user/data_dir OK)' : ' (api_user() ou data_dir() manquante !)';
        if (function_exists('data_dir')) {
            $d = data_dir();
            $out['data_dir'] = $d;
            $out['data_writable'] = $d ? is_writable($d) : false;
        }
    } catch (Throwable $e) {
        $out['auth_lib'] = 'ERREUR au chargement : ' . $e->getMessage();
    }
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
