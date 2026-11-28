<?php
/**
 * FabEvent — recherche d'une société par son n° de TVA dans le registre européen VIES
 * (à déposer à côté de sync.php). Le navigateur ne peut pas interroger VIES directement (CORS) : ce script relaie.
 *
 *   GET ?vat=BE0417497106  → {ok, valid, name, address}   (session FabEvent requise : pas de relais ouvert à tous)
 *   GET ?spec=Shure SM58   → fiche technique trouvée sur le web : {results: [{source, url, title, weight, dims, power, price, images}]}
 *   GET ?img=<url>         → image d'un résultat, relayée (le navigateur ne peut pas la lire directement chez un autre site)
 */
ini_set('display_errors', '0');
require __DIR__ . '/_fabevent.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

fe_require(fe_ws($_GET['ws'] ?? '') ?: null);

if (isset($_GET['spec']) || isset($_GET['img'])) {
    require __DIR__ . '/_specs.php';
    if (isset($_GET['img'])) fe_image((string)$_GET['img']);
    $q = trim(mb_substr((string)$_GET['spec'], 0, 160));
    if ($q === '') fe_json(400, ['error' => 'q', 'detail' => 'Indique la marque et le modèle.']);
    @set_time_limit(40);
    fe_json(200, ['ok' => true] + fe_specs($q));
}

$vat = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($_GET['vat'] ?? '')));
if (!preg_match('/^([A-Z]{2})([0-9A-Z]{2,12})$/', $vat, $m)) fe_json(400, ['error' => 'bad_vat', 'detail' => 'N° de TVA incomplet (ex. BE0417497106).']);
[$_, $cc, $num] = $m;
if ($cc === 'GR') $cc = 'EL';

$url = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/' . $cc . '/vat/' . rawurlencode($num);
$ch = curl_init($url);
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_HTTPHEADER => ['Accept: application/json'], CURLOPT_USERAGENT => 'FabEvent']);
$raw = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$j = is_string($raw) ? json_decode($raw, true) : null;
if ($code !== 200 || !is_array($j)) fe_json(502, ['error' => 'vies', 'detail' => 'Registre TVA européen (VIES) indisponible pour l\'instant : réessaie plus tard.']);
if (!empty($j['userError']) && $j['userError'] !== 'VALID' && $j['userError'] !== 'INVALID')
    fe_json(502, ['error' => 'vies', 'detail' => 'VIES : service du pays ' . $cc . ' indisponible pour l\'instant (' . $j['userError'] . ').']);

fe_json(200, ['ok' => true, 'valid' => !empty($j['isValid']), 'name' => (string)($j['name'] ?? ''), 'address' => (string)($j['address'] ?? '')]);
