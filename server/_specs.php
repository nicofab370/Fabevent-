<?php
/**
 * FabEvent — recherche de la fiche technique d'un article sur le web (utilisé par lookup.php ?spec=…).
 * 1. recherche web : Brave Search si une clé est réglée ('search_key' dans fabevent-config.php), sinon DuckDuckGo, puis Bing ;
 * 2. lecture des premières pages trouvées (fabricant, revendeurs) ;
 * 3. extraction de ce qui y figure : poids, dimensions, consommation, prix, photos (données structurées schema.org,
 *    balises Open Graph, puis le texte des tableaux de caractéristiques). Rien n'est deviné : chaque valeur vient d'une page,
 *    citée comme source, et c'est l'utilisateur qui choisit ce qu'il reprend.
 */

const FE_SPEC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
/** sites sans fiche exploitable (moteurs, vidéos, réseaux, PDF lourds…) */
const FE_SPEC_SKIP = '/(^|\.)(google\.|bing\.com|duckduckgo\.com|youtube\.com|youtu\.be|facebook\.com|instagram\.com|twitter\.com|x\.com|pinterest\.|reddit\.com|tiktok\.com|linkedin\.com|wikipedia\.org)/i';

/** URL publique http(s) uniquement : jamais une adresse du réseau local ou du serveur lui-même. */
function fe_public_url(string $url): bool {
    $p = parse_url($url);
    if (!$p || !in_array(strtolower($p['scheme'] ?? ''), ['http', 'https'], true) || empty($p['host'])) return false;
    if (isset($p['port']) && !in_array((int)$p['port'], [80, 443], true)) return false;
    $host = $p['host'];
    $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
    if (!$ips) return false;
    foreach ($ips as $ip) if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return false;
    return true;
}

/** Plusieurs pages en parallèle (taille et durée limitées, redirections vérifiées). */
function fe_fetch_many(array $urls, int $timeout = 8, int $max = 2000000): array {
    $mh = curl_multi_init();
    $hs = [];
    foreach ($urls as $i => $u) {
        if (!fe_public_url($u)) continue;
        $ch = curl_init($u);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 4, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => FE_SPEC_UA, CURLOPT_ENCODING => '',
            CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language: fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7'],
            CURLOPT_NOPROGRESS => false,
            CURLOPT_PROGRESSFUNCTION => function ($c, $dt, $d) use ($max) { return ($dt > $max || $d > $max) ? 1 : 0; },
        ]);
        curl_multi_add_handle($mh, $ch);
        $hs[$i] = $ch;
    }
    do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1); } while ($run && $st === CURLM_OK);
    $out = [];
    foreach ($hs as $i => $ch) {
        $body = curl_multi_getcontent($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $final = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $type = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
        // une redirection vers une adresse locale est ignorée
        if ($code === 200 && is_string($body) && $body !== '' && fe_public_url($final)) $out[$i] = ['url' => $final, 'type' => $type, 'body' => $body];
    }
    curl_multi_close($mh);
    return $out;
}

/** Recherche web → adresses des résultats (dans l'ordre). */
function fe_search(string $q, int $n = 8): array {
    $key = trim((string)(fe_config()['search_key'] ?? ''));
    if ($key !== '') {
        $ch = curl_init('https://api.search.brave.com/res/v1/web/search?count=' . $n . '&q=' . rawurlencode($q));
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_ENCODING => '',
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'X-Subscription-Token: ' . $key]]);
        $j = json_decode((string)curl_exec($ch), true);
        curl_close($ch);
        $urls = array_values(array_filter(array_map(fn($r) => (string)($r['url'] ?? ''), (array)($j['web']['results'] ?? []))));
        if ($urls) return fe_search_keep($urls, $n);
    }
    $pages = fe_fetch_many([
        'ddg' => 'https://html.duckduckgo.com/html/?kl=be-fr&q=' . rawurlencode($q),
        'bing' => 'https://www.bing.com/search?setlang=fr&count=20&q=' . rawurlencode($q),
    ], 10);
    $urls = [];
    if (isset($pages['ddg'])) {
        preg_match_all('/class="result__a"[^>]*href="([^"]+)"/i', $pages['ddg']['body'], $m);
        foreach ($m[1] as $h) {
            $h = html_entity_decode($h, ENT_QUOTES | ENT_HTML5);
            if (preg_match('/[?&]uddg=([^&]+)/', $h, $u)) $h = urldecode($u[1]);
            if (str_starts_with($h, '//')) $h = 'https:' . $h;
            $urls[] = $h;
        }
    }
    if (count($urls) < 3 && isset($pages['bing'])) {
        preg_match_all('/<li class="b_algo".*?<h2[^>]*>\s*<a[^>]+href="(https?:[^"]+)"/is', $pages['bing']['body'], $m);
        foreach ($m[1] as $h) {
            $h = html_entity_decode($h, ENT_QUOTES | ENT_HTML5);
            // lien de suivi Bing : l'adresse est dans u=a1<base64>
            if (preg_match('#bing\.com/ck/a\?.*[?&]u=a1([^&]+)#', $h, $u)) { $d = base64_decode(strtr($u[1], '-_', '+/')); if ($d) $h = $d; }
            $urls[] = $h;
        }
    }
    return fe_search_keep($urls, $n);
}
function fe_search_keep(array $urls, int $n): array {
    $out = [];
    foreach ($urls as $u) {
        $host = (string)parse_url($u, PHP_URL_HOST);
        if (!$host || preg_match(FE_SPEC_SKIP, $host) || preg_match('/\.pdf(\?|$)/i', $u)) continue;
        if (!in_array($u, $out, true)) $out[] = $u;
        if (count($out) >= $n) break;
    }
    return $out;
}

/** « 1.234,5 » / « 1,234.5 » / « 12,5 » → nombre */
function fe_num(string $s): ?float {
    $s = preg_replace('/[\s\x{00a0}\x{202f}]/u', '', $s);
    if (preg_match('/^\d{1,3}(\.\d{3})+(,\d+)?$/', $s)) $s = str_replace(['.', ','], ['', '.'], $s);
    elseif (preg_match('/^\d{1,3}(,\d{3})+(\.\d+)?$/', $s)) $s = str_replace(',', '', $s);
    else $s = str_replace(',', '.', $s);
    return is_numeric($s) ? (float)$s : null;
}

/** poids → kg */
function fe_kg(float $v, string $unit): ?float {
    $u = strtolower($unit);
    $kg = match (true) { $u === 'g' => $v / 1000, str_starts_with($u, 'lb') => $v * 0.45359237, $u === 'oz' => $v * 0.0283495, default => $v };
    return ($kg > 0 && $kg < 5000) ? round($kg, 3) : null;
}
/** longueur → cm */
function fe_cm(float $v, string $unit): float {
    return match (strtolower($unit)) { 'mm' => $v / 10, 'm' => $v * 100, 'in', 'inch', 'inches', '"' => $v * 2.54, default => $v };
}

/** Texte lisible d'une page (sans scripts ni styles), cellules de tableau séparées. */
function fe_page_text(string $html): string {
    $html = preg_replace('#<(script|style|noscript|svg|head)\b[^>]*>.*?</\1>#is', ' ', $html);
    $html = preg_replace('#</(td|th|dt|dd|li|p|div|tr|h\d)>|<br\s*/?>#i', "$0\n", $html);
    $t = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = preg_replace('/[ \t\x{00a0}]+/u', ' ', $t);
    return preg_replace('/\n\s*\n+/', "\n", $t);
}

/** Objets JSON-LD de la page (à plat, @graph compris). */
function fe_jsonld(string $html): array {
    preg_match_all('#<script[^>]+application/ld\+json[^>]*>(.*?)</script>#is', $html, $m);
    $out = [];
    $walk = function ($v) use (&$walk, &$out) {
        if (!is_array($v)) return;
        if (isset($v['@type'])) $out[] = $v;
        foreach (['@graph', 'mainEntity', 'itemListElement'] as $k) if (isset($v[$k])) $walk($v[$k]);
        if (array_is_list($v)) foreach ($v as $x) $walk($x);
    };
    foreach ($m[1] as $raw) $walk(json_decode(trim($raw), true));
    return $out;
}

function fe_meta(string $html, string $prop): ?string {
    if (preg_match('#<meta[^>]+(?:property|name|itemprop)=["\']' . preg_quote($prop, '#') . '["\'][^>]*content=["\']([^"\']+)#i', $html, $m)
        || preg_match('#<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name|itemprop)=["\']' . preg_quote($prop, '#') . '["\']#i', $html, $m))
        return html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5);
    return null;
}

/** Caractéristiques trouvées dans une page. */
function fe_extract(string $html, string $url): array {
    $r = ['url' => $url, 'source' => preg_replace('/^www\./', '', (string)parse_url($url, PHP_URL_HOST))];
    $abs = function (string $u) use ($url) {
        if (preg_match('#^https?://#i', $u)) return $u;
        $p = parse_url($url);
        if (str_starts_with($u, '//')) return $p['scheme'] . ':' . $u;
        if (str_starts_with($u, '/')) return $p['scheme'] . '://' . $p['host'] . $u;
        return $p['scheme'] . '://' . $p['host'] . rtrim(dirname($p['path'] ?? '/'), '/') . '/' . $u;
    };
    $images = [];

    // 1. données structurées schema.org (revendeurs, fabricants)
    foreach (fe_jsonld($html) as $o) {
        $types = (array)$o['@type'];
        if (!array_intersect($types, ['Product', 'IndividualProduct', 'ProductModel'])) continue;
        if (!empty($o['name']) && empty($r['title'])) $r['title'] = trim((string)$o['name']);
        foreach ((array)($o['image'] ?? []) as $im) { $im = is_array($im) ? ($im['url'] ?? $im['contentUrl'] ?? '') : $im; if (is_string($im) && $im) $images[] = $abs($im); }
        $offers = $o['offers'] ?? null;
        if (is_array($offers)) {
            $list = array_is_list($offers) ? $offers : [$offers];
            foreach ($list as $of) {
                $price = $of['price'] ?? $of['lowPrice'] ?? ($of['priceSpecification']['price'] ?? null);
                $cur = $of['priceCurrency'] ?? ($of['priceSpecification']['priceCurrency'] ?? '');
                if ($price !== null && ($p = fe_num((string)$price)) && $p > 0 && empty($r['price'])) $r['price'] = ['amount' => round($p, 2), 'currency' => strtoupper((string)$cur) ?: 'EUR'];
            }
        }
        $w = $o['weight'] ?? null;
        if (is_array($w) && isset($w['value']) && ($v = fe_num((string)$w['value']))) {
            $unit = strtoupper((string)($w['unitCode'] ?? $w['unitText'] ?? 'KGM'));
            $r['weight'] ??= fe_kg($v, match (true) { str_contains($unit, 'GRM') || $unit === 'G' => 'g', str_contains($unit, 'LB') => 'lb', default => 'kg' });
        } elseif (is_string($w) && preg_match('/([\d.,]+)\s*(kg|g|lbs?)\b/i', $w, $m) && ($v = fe_num($m[1]))) $r['weight'] ??= fe_kg($v, $m[2]);
        $dim = [];
        foreach (['depth' => 'l', 'width' => 'w', 'height' => 'h'] as $k => $d) {
            $x = $o[$k] ?? null;
            if (is_array($x) && isset($x['value']) && ($v = fe_num((string)$x['value']))) {
                $u = strtoupper((string)($x['unitCode'] ?? 'CMT'));
                $dim[$d] = round(fe_cm($v, match ($u) { 'MMT' => 'mm', 'MTR' => 'm', 'INH' => 'in', default => 'cm' }), 1);
            }
        }
        if (count($dim) === 3) $r['dims'] ??= $dim;
        if (!empty($o['brand'])) $r['brand'] ??= is_array($o['brand']) ? (string)($o['brand']['name'] ?? '') : (string)$o['brand'];
    }

    // 2. Open Graph et microdonnées
    foreach (['og:image', 'og:image:secure_url', 'twitter:image', 'image'] as $p) if ($v = fe_meta($html, $p)) $images[] = $abs($v);
    $r['title'] ??= fe_meta($html, 'og:title') ?? (preg_match('#<title[^>]*>(.*?)</title>#is', $html, $m) ? trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5)) : null);
    if (empty($r['price']) && ($p = fe_meta($html, 'product:price:amount') ?? fe_meta($html, 'og:price:amount') ?? fe_meta($html, 'price')) && ($v = fe_num($p)) && $v > 0)
        $r['price'] = ['amount' => round($v, 2), 'currency' => strtoupper(fe_meta($html, 'product:price:currency') ?? fe_meta($html, 'og:price:currency') ?? fe_meta($html, 'priceCurrency') ?? 'EUR')];

    // 3. texte des caractéristiques (FR, EN, NL, DE)
    $t = fe_page_text($html);
    $num = '(\d{1,4}(?:[.,]\d{1,3})?)';
    if (empty($r['weight']) && preg_match('/(?:poids|weight|gewicht|masse)(?:\s*(?:net|netto|nett|unitaire|du produit|\(net\)))?\s*[:\-–]?\s*(?:ca\.?|env\.?|approx\.?)?\s*' . $num . '\s*(kg|g|lbs?|oz)\b/iu', $t, $m) && ($v = fe_num($m[1])))
        $r['weight'] = fe_kg($v, $m[2]);
    if (empty($r['dims']) && preg_match('/(?:dimensions?|afmetingen|abmessungen|size|taille|maße)[^\d]{0,40}' . $num . '\s*(mm|cm|m|in|")?\s*[x×*]\s*' . $num . '\s*(mm|cm|m|in|")?\s*[x×*]\s*' . $num . '\s*(mm|cm|m|in|inch|inches|")/iu', $t, $m)) {
        $u = $m[6] ?: ($m[2] ?: $m[4]);
        $vals = array_map(fn($x) => fe_num($x), [$m[1], $m[3], $m[5]]);
        if (!in_array(null, $vals, true)) {
            $c = array_map(fn($x) => round(fe_cm($x, $u), 1), $vals);
            if (max($c) < 2000) $r['dims'] = ['l' => $c[0], 'w' => $c[1], 'h' => $c[2]];
        }
    }
    if (preg_match('/(?:consommation(?: électrique| maximale| max\.?)?|power consumption|puissance (?:absorbée|consommée|max\.?)|max(?:imum)?\.? power|verbruik|stroomverbruik|leistungsaufnahme)\s*[:\-–]?\s*(?:max\.?\s*)?' . $num . '\s*(W|kW|watts?)\b/iu', $t, $m) && ($v = fe_num($m[1])))
        $r['power'] = round(strtolower($m[2]) === 'kw' ? $v * 1000 : $v);

    $r['images'] = array_values(array_unique(array_filter($images, fn($u) => preg_match('#^https?://#i', $u) && !preg_match('/logo|sprite|icon|placeholder|blank\.(gif|png)/i', $u))));
    $r['images'] = array_slice($r['images'], 0, 3);
    return array_filter($r, fn($v) => $v !== null && $v !== '' && $v !== []);
}

/** Recherche complète : résultats web lus, une entrée par page qui contient au moins une caractéristique. */
function fe_specs(string $q): array {
    $urls = fe_search($q, 8);
    $pages = fe_fetch_many(array_slice($urls, 0, 6), 8);
    $out = [];
    foreach ($urls as $i => $u) {
        if (!isset($pages[$i]) || !preg_match('#html|xml#i', $pages[$i]['type'] ?: 'text/html')) continue;
        $x = fe_extract($pages[$i]['body'], $pages[$i]['url']);
        if (array_intersect_key($x, ['weight' => 1, 'dims' => 1, 'power' => 1, 'price' => 1, 'images' => 1])) $out[] = $x;
    }
    return ['query' => $q, 'searched' => count($urls), 'results' => $out];
}

/** Image d'une page trouvée, relayée pour que le navigateur puisse la réduire (types image seulement, 6 Mo max). */
function fe_image(string $url): void {
    $r = fe_fetch_many([$url], 10, 6000000)[0] ?? null;
    if (!$r || !preg_match('#^image/(jpeg|png|webp|gif|avif)#i', $r['type'], $m)) fe_json(404, ['error' => 'image']);
    header('Content-Type: image/' . strtolower($m[1]));
    header('Cache-Control: private, max-age=600');
    echo $r['body'];
    exit;
}
