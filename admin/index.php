<?php

declare(strict_types=1);

require dirname(__DIR__) . '/lib/bootstrap.php';

$key = $_GET['key'] ?? '';
$authorized = is_string($key) && $key === app_config()['admin_secret'];
$rootPath = root_path();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Shopping List Admin</title>
    <link rel="stylesheet" href="<?= htmlspecialchars($rootPath . '/assets/app.css', ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="admin-body" data-admin-key="<?= htmlspecialchars((string) $key, ENT_QUOTES, 'UTF-8') ?>">
    <main class="admin-shell">
        <?php if (!$authorized): ?>
            <section class="admin-card">
                <h1>Admin access denied</h1>
                <p>Use the correct `?key=` secret from `config.php`.</p>
            </section>
        <?php else: ?>
            <section class="admin-card">
                <p class="eyebrow">Household access control</p>
                <h1>Manage family links</h1>
                <p id="userCountText">Loading users...</p>
                <form id="userForm" class="admin-form">
                    <label for="displayName">Display name</label>
                    <input id="displayName" name="name" type="text" maxlength="40" placeholder="Sarah" required>
                    <button type="submit">Generate Link</button>
                </form>
                <div id="newUserPanel" class="generated-link hidden"></div>
            </section>

            <section class="admin-card">
                <h2>Users</h2>
                <div id="userList" class="admin-user-list"></div>
            </section>
        <?php endif; ?>
    </main>

    <?php if ($authorized): ?>
        <div id="toastRoot" class="toast-root" aria-live="assertive" aria-atomic="true"></div>
        <script>
            window.ADMIN_BOOT = {
                rootPath: <?= json_encode($rootPath, JSON_UNESCAPED_SLASHES) ?>,
            };
        </script>
        <script src="<?= htmlspecialchars($rootPath . '/assets/admin.js', ENT_QUOTES, 'UTF-8') ?>" defer></script>
    <?php endif; ?>
</body>
</html>
