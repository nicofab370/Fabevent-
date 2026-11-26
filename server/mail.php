<?php
/**
 * FabEvent — envoi des emails depuis la plateforme (à déposer à côté de sync.php, ex. /fabevent/api/mail.php).
 *
 * - Accès : session FabEvent (auth.php), comme sync.php — aucune dépendance aux pages internes du site.
 * - Réglages : fichier mail-config.php à côté de ce fichier (jamais dans le dépôt Git), voir mail-config.example.php.
 *   Avec un serveur SMTP (recommandé : les mails arrivent mieux), sinon la fonction mail() de l'hébergement.
 *
 * Actions :
 *   GET  ?action=status  → {ok, mode, from}  (l'application sait alors qu'elle peut envoyer directement)
 *   POST ?action=send    {to:[], cc:[], bcc:[], replyTo, subject, text, attachments:[{name, type, data(base64)}]}
 */
ini_set('display_errors', '0');

require __DIR__ . '/_fabevent.php';   // connexion avec les comptes FabEvent (aucune dépendance aux pages internes)

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function out(int $status, array $data): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$U = fe_require(fe_ws($_GET['ws'] ?? '') ?: null);   // session FabEvent (sur la base indiquée, sinon n'importe laquelle)

/* ---------- réglages ---------- */
$cfgFile = getenv('FABEVENT_MAIL_CONFIG') ?: __DIR__ . '/mail-config.php';
$cfg = is_file($cfgFile) ? (require $cfgFile) : [];
if (!is_array($cfg)) $cfg = [];
$outbox = getenv('FABEVENT_MAIL_OUTBOX') ?: ($cfg['outbox'] ?? '');   // tests : les mails sont écrits dans un dossier
$host = preg_replace('/[^a-z0-9.-]/i', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
$from = (string)($cfg['from'] ?? ('noreply@' . preg_replace('/^www\./', '', explode(':', $host)[0])));
$fromName = (string)($cfg['fromName'] ?? 'FabEvent');
$mode = $outbox ? 'outbox' : (!empty($cfg['smtp']['host']) ? 'smtp' : 'mail');

$action = $_GET['action'] ?? '';
if ($action === 'status') out(200, ['ok' => true, 'mode' => $mode, 'from' => $from, 'user' => (string)($U['email'] ?? '')]);
if ($action !== 'send' || $_SERVER['REQUEST_METHOD'] !== 'POST') out(400, ['error' => 'unknown_action']);

$raw = (string)file_get_contents('php://input');
if (strlen($raw) > 35 * 1024 * 1024) out(413, ['error' => 'too_big', 'detail' => 'Pièces jointes trop lourdes (25 Mo au plus).']);
$b = json_decode($raw, true);
if (!is_array($b)) out(400, ['error' => 'bad_request']);

/* ---------- contrôle des adresses ---------- */
function addrs($v): array {
    $list = is_array($v) ? $v : preg_split('/[,;]+/', (string)$v);
    $out = [];
    foreach ($list as $a) {
        $a = trim((string)$a);
        if ($a === '') continue;
        // « Nom <adresse> » accepté
        if (preg_match('/<([^>]+)>/', $a, $m)) $a = trim($m[1]);
        if (!filter_var($a, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $a)) out(400, ['error' => 'bad_address', 'detail' => "Adresse invalide : $a"]);
        $out[] = $a;
    }
    return array_values(array_unique($out));
}
$to = addrs($b['to'] ?? []); $cc = addrs($b['cc'] ?? []); $bcc = addrs($b['bcc'] ?? []);
if (!$to && !$bcc) out(400, ['error' => 'no_recipient', 'detail' => 'Aucun destinataire.']);
if (count($to) + count($cc) + count($bcc) > 50) out(400, ['error' => 'too_many', 'detail' => '50 destinataires au plus.']);
$replyTo = addrs($b['replyTo'] ?? '')[0] ?? '';
$subject = trim(preg_replace('/[\r\n]+/', ' ', (string)($b['subject'] ?? '')));
$text = str_replace(["\r\n", "\r"], "\n", (string)($b['text'] ?? ''));
$atts = is_array($b['attachments'] ?? null) ? array_slice($b['attachments'], 0, 20) : [];

/* ---------- message MIME ---------- */
$hdr = fn(string $s) => preg_match('/^[\x20-\x7e]*$/', $s) ? $s : '=?UTF-8?B?' . base64_encode($s) . '?=';
$boundary = 'fabevent-' . bin2hex(random_bytes(8));
$domain = substr(strrchr($from, '@'), 1) ?: 'localhost';
$headers = [
    'From: ' . $hdr($fromName) . " <$from>",
    'Date: ' . date('r'),
    'Message-ID: <' . bin2hex(random_bytes(12)) . "@$domain>",
    'MIME-Version: 1.0',
    "Content-Type: multipart/mixed; boundary=\"$boundary\"",
    'X-Mailer: FabEvent',
];
if ($cc) $headers[] = 'Cc: ' . implode(', ', $cc);
if ($replyTo) $headers[] = "Reply-To: $replyTo";
$body = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
    . chunk_split(base64_encode(str_replace("\n", "\r\n", $text)), 76, "\r\n");
$total = 0;
foreach ($atts as $a) {
    $name = preg_replace('/[\r\n"]+/', '', (string)($a['name'] ?? 'fichier'));
    $type = preg_match('/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i', (string)($a['type'] ?? '')) ? $a['type'] : 'application/octet-stream';
    $data = base64_decode((string)($a['data'] ?? ''), true);
    if ($data === false) out(400, ['error' => 'bad_attachment', 'detail' => "Pièce jointe illisible : $name"]);
    $total += strlen($data);
    if ($total > 25 * 1024 * 1024) out(413, ['error' => 'too_big', 'detail' => 'Pièces jointes trop lourdes (25 Mo au plus).']);
    $n = $hdr($name);
    $body .= "--$boundary\r\nContent-Type: $type; name=\"$n\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"$n\"\r\n\r\n"
        . chunk_split(base64_encode($data), 76, "\r\n");
}
$body .= "--$boundary--\r\n";

/* ---------- envoi ---------- */
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
    $caps = $cmd($ehlo, [250]);
    if ($secure === 'tls') {
        $cmd('STARTTLS', [220]);
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('STARTTLS refusé');
        $caps = $cmd($ehlo, [250]);
    }
    if (!empty($s['user'])) {
        $cmd('AUTH LOGIN', [334]);
        $cmd(base64_encode((string)$s['user']), [334]);
        $cmd(base64_encode((string)($s['pass'] ?? '')), [235]);
    }
    $cmd("MAIL FROM:<$from>", [250]);
    foreach ($rcpt as $r) $cmd("RCPT TO:<$r>", [250, 251]);
    $cmd('DATA', [354]);
    // les lignes qui commencent par un point sont doublées (RFC 5321)
    fwrite($fp, preg_replace('/^\./m', '..', $data) . "\r\n.\r\n");
    $cmd('', [250]);
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
}

try {
    if ($mode === 'outbox') {
        if (!is_dir($outbox)) mkdir($outbox, 0700, true);
        $eml = 'To: ' . implode(', ', $to) . "\r\n" . ($bcc ? 'Bcc: ' . implode(', ', $bcc) . "\r\n" : '') . 'Subject: ' . $hdr($subject) . "\r\n" . implode("\r\n", $headers) . "\r\n\r\n" . $body;
        file_put_contents($outbox . '/' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.eml', $eml);
    } elseif ($mode === 'smtp') {
        $data = 'To: ' . implode(', ', $to) . "\r\nSubject: " . $hdr($subject) . "\r\n" . implode("\r\n", $headers) . "\r\n\r\n" . $body;
        smtp_send($cfg['smtp'], $from, array_merge($to, $cc, $bcc), $data);
    } else {
        $h = $headers;
        if ($bcc) $h[] = 'Bcc: ' . implode(', ', $bcc);
        if (!mail(implode(', ', $to), $hdr($subject), $body, implode("\r\n", $h), '-f' . $from)) throw new RuntimeException("La fonction mail() de l'hébergement a refusé l'envoi");
    }
} catch (Throwable $e) {
    out(502, ['error' => 'send_failed', 'detail' => $e->getMessage()]);
}
out(200, ['ok' => true, 'mode' => $mode, 'to' => $to, 'cc' => $cc, 'bcc' => count($bcc)]);
