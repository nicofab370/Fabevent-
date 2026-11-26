<?php
/** Remplace interne/_lib/auth.php pendant les tests : l'utilisateur vient du cookie « testuser ». */
function api_user(): array {
    $l = (string)($_COOKIE['testuser'] ?? ($_SERVER['HTTP_X_TEST_USER'] ?? ''));
    if ($l === '') { http_response_code(401); header('Content-Type: application/json'); echo '{"error":"auth"}'; exit; }
    return ['login' => $l, 'shared' => $l !== 'externe'];
}
function can_use_shared(array $u): bool { return !empty($u['shared']); }
function data_dir(): string { $d = getenv('FABEVENT_DATA'); if (!is_dir($d)) mkdir($d, 0755, true); return $d; }
/** comme la vraie bibliothèque interne/_lib/auth.php : h() y est déjà définie */
function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
