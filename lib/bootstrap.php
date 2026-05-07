<?php

declare(strict_types=1);

const STORE_DEFS = [
    'costco' => ['label' => 'Costco', 'short' => 'Costco', 'color' => '#c95b5b'],
    'traderjoes' => ['label' => "Trader Joe's", 'short' => "TJ's", 'color' => '#d27d4d'],
    'wholefoods' => ['label' => 'Whole Foods', 'short' => 'WF', 'color' => '#4f7b58'],
    'sns' => ['label' => 'Stop & Shop', 'short' => 'SnS', 'color' => '#607a9d'],
    'wegmans' => ['label' => 'Wegmans', 'short' => 'Wegmans', 'color' => '#7d6f99'],
    'palmers' => ['label' => 'Palmers', 'short' => 'Palmers', 'color' => '#08c076'],
    'shoprite' => ['label' => 'ShopRite', 'short' => 'ShopRite', 'color' => '#a65f6c'],
    'other' => ['label' => 'Other', 'short' => 'Other', 'color' => '#6f7b80'],
];

const USER_COLORS = [
    '#e77f7f',
    '#5e7bb1',
    '#2f9f8f',
    '#cf8858',
    '#8b6fc4',
];

function app_config(): array
{
    static $config;

    if ($config !== null) {
        return $config;
    }

    $config = require dirname(__DIR__) . '/config.php';

    return $config;
}

function db(): PDO
{
    static $pdo;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = app_config();
    $dir = dirname($config['db_path']);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }

    $pdo = new PDO('sqlite:' . $config['db_path']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');

    initialize_schema($pdo);

    return $pdo;
}

function initialize_schema(PDO $pdo): void
{
    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_active_at INTEGER,
            active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS auth_tokens (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            active INTEGER DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            store TEXT NOT NULL,
            added_by TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            completed_by TEXT,
            completed_at INTEGER,
            deleted INTEGER DEFAULT 0,
            deleted_at INTEGER,
            FOREIGN KEY (added_by) REFERENCES users(id)
        );
        SQL
    );

    migrate_auth_tokens($pdo);
}

function migrate_auth_tokens(PDO $pdo): void
{
    $tokenCount = (int) $pdo->query('SELECT COUNT(*) FROM auth_tokens')->fetchColumn();
    if ($tokenCount > 0) {
        return;
    }

    $rows = $pdo->query('SELECT id, created_at, active FROM users')->fetchAll();
    $stmt = $pdo->prepare(
        'INSERT OR IGNORE INTO auth_tokens (token, user_id, created_at, active)
         VALUES (:token, :user_id, :created_at, :active)'
    );

    foreach ($rows as $row) {
        $stmt->execute([
            ':token' => $row['id'],
            ':user_id' => $row['id'],
            ':created_at' => (int) $row['created_at'],
            ':active' => (int) $row['active'],
        ]);
    }
}

function now_ts(): int
{
    return time();
}

function json_input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        error_json('Invalid JSON payload.', 400);
    }

    return $decoded;
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function error_json(string $message, int $status = 400): void
{
    json_response(['ok' => false, 'error' => $message], $status);
}

function request_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function request_token(): ?string
{
    $token = $_GET['u'] ?? $_SERVER['HTTP_X_USER_TOKEN'] ?? null;
    if (is_string($token) && $token !== '') {
        return $token;
    }

    return null;
}

function request_admin_key(): ?string
{
    $key = $_GET['key'] ?? $_SERVER['HTTP_X_ADMIN_KEY'] ?? null;
    if (is_string($key) && $key !== '') {
        return $key;
    }

    return null;
}

function require_admin(): void
{
    $config = app_config();
    if (request_admin_key() !== $config['admin_secret']) {
        error_json('Unauthorized.', 401);
    }
}

function require_user(bool $allowInactive = false): array
{
    $token = request_token();
    if ($token === null) {
        error_json('Missing user token.', 401);
    }

    $stmt = db()->prepare(
        'SELECT u.*
         FROM auth_tokens t
         INNER JOIN users u ON u.id = t.user_id
         WHERE t.token = :token AND t.active = 1
         LIMIT 1'
    );
    $stmt->execute([':token' => $token]);
    $user = $stmt->fetch();

    if (!$user) {
        error_json('Invalid user token.', 401);
    }

    if (!$allowInactive && (int) $user['active'] !== 1) {
        error_json('User is inactive.', 401);
    }

    touch_user_last_active($user['id']);
    $user['active'] = (int) $user['active'];

    return $user;
}

function touch_user_last_active(string $userId): void
{
    $stmt = db()->prepare('UPDATE users SET last_active_at = :ts WHERE id = :id');
    $stmt->execute([
        ':ts' => now_ts(),
        ':id' => $userId,
    ]);
}

function generate_token(int $length = 16): string
{
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $max = strlen($chars) - 1;
    $token = '';
    for ($i = 0; $i < $length; $i++) {
        $token .= $chars[random_int(0, $max)];
    }

    return $token;
}

function next_user_color(PDO $pdo): string
{
    $count = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    return USER_COLORS[$count % count(USER_COLORS)];
}

function validate_store(string $store): string
{
    if (!isset(STORE_DEFS[$store])) {
        error_json('Invalid store.', 422);
    }

    return $store;
}

function format_user_row(array $row): array
{
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'color' => $row['color'],
        'created_at' => (int) $row['created_at'],
        'last_active_at' => $row['last_active_at'] !== null ? (int) $row['last_active_at'] : null,
        'active' => (int) $row['active'] === 1,
    ];
}

function list_users_indexed(PDO $pdo, bool $activeOnly = false): array
{
    $sql = 'SELECT * FROM users';
    if ($activeOnly) {
        $sql .= ' WHERE active = 1';
    }
    $sql .= ' ORDER BY created_at ASC';

    $rows = $pdo->query($sql)->fetchAll();
    $tokenStmt = $pdo->prepare(
        'SELECT token
         FROM auth_tokens
         WHERE user_id = :user_id AND active = 1
         ORDER BY created_at DESC
         LIMIT 1'
    );
    $users = [];
    foreach ($rows as $row) {
        $user = format_user_row($row);
        $tokenStmt->execute([':user_id' => $user['id']]);
        $token = $tokenStmt->fetchColumn();
        $user['current_link'] = $token ? user_link((string) $token) : null;
        $users[$user['id']] = $user;
    }

    return $users;
}

function format_item_row(array $row, array $users): array
{
    $addedBy = $users[$row['added_by']] ?? null;
    $completedBy = $row['completed_by'] ? ($users[$row['completed_by']] ?? null) : null;

    return [
        'id' => (int) $row['id'],
        'text' => $row['text'],
        'store' => $row['store'],
        'added_by' => $row['added_by'],
        'added_by_name' => $addedBy['name'] ?? 'Unknown',
        'added_by_color' => $addedBy['color'] ?? '#6f7b80',
        'added_at' => (int) $row['added_at'],
        'completed_by' => $row['completed_by'],
        'completed_by_name' => $completedBy['name'] ?? null,
        'completed_at' => $row['completed_at'] !== null ? (int) $row['completed_at'] : null,
        'deleted' => (int) $row['deleted'] === 1,
        'deleted_at' => $row['deleted_at'] !== null ? (int) $row['deleted_at'] : null,
    ];
}

function fetch_items_payload(PDO $pdo, ?string $storeFilter = null): array
{
    $users = list_users_indexed($pdo);
    $sql = 'SELECT * FROM items WHERE deleted = 0';
    $params = [];
    if ($storeFilter !== null) {
        $sql .= ' AND store = :store';
        $params[':store'] = $storeFilter;
    }
    $sql .= ' ORDER BY store ASC, (completed_at IS NOT NULL) ASC, added_at DESC, id DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $items = [];
    foreach ($rows as $row) {
        $items[] = format_item_row($row, $users);
    }

    return [
        'users' => array_values($users),
        'items' => $items,
        'meta' => [
            'generated_at' => now_ts(),
            'last_modified' => last_modified_ts($pdo),
            'stores' => STORE_DEFS,
            'completed_archive_after_seconds' => 2 * 24 * 60 * 60,
        ],
    ];
}

function last_modified_ts(PDO $pdo): int
{
    $userMax = (int) $pdo->query('SELECT COALESCE(MAX(created_at), 0) FROM users')->fetchColumn();
    $itemMax = (int) $pdo->query('SELECT COALESCE(MAX(CASE
        WHEN deleted_at IS NOT NULL THEN deleted_at
        WHEN completed_at IS NOT NULL THEN completed_at
        ELSE added_at
    END), 0) FROM items')->fetchColumn();

    return max($userMax, $itemMax);
}

function item_by_id(PDO $pdo, int $id): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM items WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    return $row ?: null;
}

function base_url(): string
{
    return rtrim(app_config()['base_url'], '/');
}

function user_link(string $token): string
{
    return base_url() . '/?u=' . urlencode($token);
}

function generate_unique_value(PDO $pdo, string $table, string $column, int $length = 16): string
{
    do {
        $value = generate_token($length);
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM {$table} WHERE {$column} = :value");
        $stmt->execute([':value' => $value]);
        $exists = (int) $stmt->fetchColumn() > 0;
    } while ($exists);

    return $value;
}

function create_user(PDO $pdo, string $name): array
{
    $userId = generate_unique_value($pdo, 'users', 'id', 16);
    $token = generate_unique_value($pdo, 'auth_tokens', 'token', 16);
    $timestamp = now_ts();

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO users (id, name, color, created_at, last_active_at, active)
             VALUES (:id, :name, :color, :created_at, NULL, 1)'
        );
        $stmt->execute([
            ':id' => $userId,
            ':name' => substr($name, 0, 40),
            ':color' => next_user_color($pdo),
            ':created_at' => $timestamp,
        ]);

        $tokenStmt = $pdo->prepare(
            'INSERT INTO auth_tokens (token, user_id, created_at, active)
             VALUES (:token, :user_id, :created_at, 1)'
        );
        $tokenStmt->execute([
            ':token' => $token,
            ':user_id' => $userId,
            ':created_at' => $timestamp,
        ]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    return [
        'user' => list_users_indexed($pdo)[$userId],
        'link' => user_link($token),
    ];
}

function deactivate_user(PDO $pdo, string $userId): void
{
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('UPDATE users SET active = 0 WHERE id = :id');
        $stmt->execute([':id' => $userId]);

        $tokenStmt = $pdo->prepare('UPDATE auth_tokens SET active = 0 WHERE user_id = :user_id');
        $tokenStmt->execute([':user_id' => $userId]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function regenerate_user_link(PDO $pdo, string $userId): string
{
    $token = generate_unique_value($pdo, 'auth_tokens', 'token', 16);
    $timestamp = now_ts();

    $pdo->beginTransaction();
    try {
        $disableStmt = $pdo->prepare('UPDATE auth_tokens SET active = 0 WHERE user_id = :user_id');
        $disableStmt->execute([':user_id' => $userId]);

        $insertStmt = $pdo->prepare(
            'INSERT INTO auth_tokens (token, user_id, created_at, active)
             VALUES (:token, :user_id, :created_at, 1)'
        );
        $insertStmt->execute([
            ':token' => $token,
            ':user_id' => $userId,
            ':created_at' => $timestamp,
        ]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    return user_link($token);
}

function root_path(): string
{
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
    $dir = str_replace('\\', '/', dirname($scriptName));
    if ($dir === '/' || $dir === '\\' || $dir === '.') {
        return '';
    }

    if (str_ends_with($dir, '/admin')) {
        $dir = substr($dir, 0, -6);
    }

    return rtrim($dir, '/');
}
