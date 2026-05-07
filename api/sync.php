<?php

declare(strict_types=1);

require dirname(__DIR__) . '/lib/bootstrap.php';

$pdo = db();
$user = require_user();

$itemCount = (int) $pdo->query('SELECT COUNT(*) FROM items WHERE deleted = 0')->fetchColumn();

json_response([
    'ok' => true,
    'current_user' => $user,
    'last_modified' => last_modified_ts($pdo),
    'item_count' => $itemCount,
    'generated_at' => now_ts(),
]);

