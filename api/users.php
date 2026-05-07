<?php

declare(strict_types=1);

require dirname(__DIR__) . '/lib/bootstrap.php';

$pdo = db();
$method = request_method();

if ($method === 'GET') {
    require_admin();
    $users = array_values(list_users_indexed($pdo, true));
    $activeCount = count($users);

    json_response([
        'ok' => true,
        'users' => $users,
        'active_count' => $activeCount,
        'max_users' => app_config()['max_users'],
    ]);
}

if ($method === 'POST') {
    require_admin();
    $input = json_input();
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') {
        error_json('Display name is required.', 422);
    }

    $activeCount = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE active = 1')->fetchColumn();
    $maxUsers = (int) app_config()['max_users'];
    if ($activeCount >= $maxUsers) {
        error_json("User limit reached ({$maxUsers} max active users).", 422);
    }

    $created = create_user($pdo, $name);
    json_response([
        'ok' => true,
        'user' => $created['user'],
        'link' => $created['link'],
    ], 201);
}

if ($method === 'PATCH') {
    require_admin();
    $input = json_input();
    $userId = (string) ($input['id'] ?? '');
    $action = (string) ($input['action'] ?? '');
    if ($userId === '') {
        error_json('User id is required.', 422);
    }

    if ($action !== 'regenerate_link') {
        error_json('Unsupported action.', 422);
    }

    $stmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE id = :id AND active = 1');
    $stmt->execute([':id' => $userId]);
    if ((int) $stmt->fetchColumn() === 0) {
        error_json('Active user not found.', 404);
    }

    $link = regenerate_user_link($pdo, $userId);
    $user = list_users_indexed($pdo)[$userId] ?? null;

    json_response([
        'ok' => true,
        'user' => $user,
        'link' => $link,
    ]);
}

if ($method === 'DELETE') {
    require_admin();
    $input = json_input();
    $userId = (string) ($input['id'] ?? '');
    if ($userId === '') {
        error_json('User id is required.', 422);
    }

    deactivate_user($pdo, $userId);

    json_response([
        'ok' => true,
        'id' => $userId,
    ]);
}

error_json('Method not allowed.', 405);
