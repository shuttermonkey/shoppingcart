<?php

declare(strict_types=1);

require dirname(__DIR__) . '/lib/bootstrap.php';

$pdo = db();
$method = request_method();

if ($method === 'GET') {
    $user = require_user();
    $store = isset($_GET['store']) ? validate_store((string) $_GET['store']) : null;
    $payload = fetch_items_payload($pdo, $store);
    $payload['ok'] = true;
    $payload['current_user'] = $user;
    json_response($payload);
}

if ($method === 'POST') {
    $user = require_user();
    $input = json_input();
    $text = validate_item_text((string) ($input['text'] ?? ''));
    $store = validate_store((string) ($input['store'] ?? ''));

    $stmt = $pdo->prepare(
        'INSERT INTO items (text, store, added_by, added_at, updated_at, completed_by, completed_at, deleted, deleted_at)
         VALUES (:text, :store, :added_by, :added_at, NULL, NULL, NULL, 0, NULL)'
    );
    $stmt->execute([
        ':text' => $text,
        ':store' => $store,
        ':added_by' => $user['id'],
        ':added_at' => now_ts(),
    ]);

    $item = item_by_id($pdo, (int) $pdo->lastInsertId());
    json_response([
        'ok' => true,
        'item' => format_item_row($item, list_users_indexed($pdo)),
        'last_modified' => last_modified_ts($pdo),
    ], 201);
}

if ($method === 'PATCH') {
    $user = require_user();
    $input = json_input();
    $action = (string) ($input['action'] ?? '');
    $itemId = (int) ($input['id'] ?? 0);
    $item = item_by_id($pdo, $itemId);

    if (!$item) {
        error_json('Item not found.', 404);
    }

    $timestamp = now_ts();

    if ($action === 'toggle_complete') {
        $isCompleted = $item['completed_at'] !== null;
        $stmt = $pdo->prepare(
            'UPDATE items
             SET completed_by = :completed_by, completed_at = :completed_at
             WHERE id = :id'
        );
        $stmt->execute([
            ':completed_by' => $isCompleted ? null : $user['id'],
            ':completed_at' => $isCompleted ? null : $timestamp,
            ':id' => $itemId,
        ]);
    } elseif ($action === 'delete') {
        $stmt = $pdo->prepare('UPDATE items SET deleted = 1, deleted_at = :deleted_at WHERE id = :id');
        $stmt->execute([
            ':deleted_at' => $timestamp,
            ':id' => $itemId,
        ]);
    } elseif ($action === 'undo_delete') {
        $stmt = $pdo->prepare('UPDATE items SET deleted = 0, deleted_at = NULL WHERE id = :id');
        $stmt->execute([':id' => $itemId]);
    } elseif ($action === 'edit') {
        $text = validate_item_text((string) ($input['text'] ?? $item['text']));
        $store = validate_store((string) ($input['store'] ?? $item['store']));
        $stmt = $pdo->prepare(
            'UPDATE items
             SET text = :text, store = :store, updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            ':text' => $text,
            ':store' => $store,
            ':updated_at' => $timestamp,
            ':id' => $itemId,
        ]);
    } elseif ($action === 'readd') {
        $stmt = $pdo->prepare(
            'INSERT INTO items (text, store, added_by, added_at, updated_at, completed_by, completed_at, deleted, deleted_at)
             VALUES (:text, :store, :added_by, :added_at, NULL, NULL, NULL, 0, NULL)'
        );
        $stmt->execute([
            ':text' => $item['text'],
            ':store' => $item['store'],
            ':added_by' => $user['id'],
            ':added_at' => $timestamp,
        ]);
        $newItem = item_by_id($pdo, (int) $pdo->lastInsertId());
        json_response([
            'ok' => true,
            'item' => format_item_row($newItem, list_users_indexed($pdo)),
            'last_modified' => last_modified_ts($pdo),
        ], 201);
    } else {
        error_json('Unsupported action.', 422);
    }

    $updated = item_by_id($pdo, $itemId);
    json_response([
        'ok' => true,
        'item' => format_item_row($updated, list_users_indexed($pdo)),
        'last_modified' => last_modified_ts($pdo),
    ]);
}

error_json('Method not allowed.', 405);
