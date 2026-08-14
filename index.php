<?php

declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

$bootToken = '';
if (isset($_GET['u']) && is_string($_GET['u'])) {
    $bootToken = $_GET['u'];
}
$rootPath = root_path();
$assetVersion = '20260814-previously-purchased-v2';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Family Shopping List</title>
    <meta name="theme-color" content="#2c6b78">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Shopping List">
    <meta name="mobile-web-app-capable" content="yes">
    <link rel="stylesheet" href="<?= htmlspecialchars($rootPath . '/assets/app.css?v=' . $assetVersion, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="apple-touch-icon" href="<?= htmlspecialchars($rootPath . '/assets/icon.png') ?>">
</head>
<body data-boot-token="<?= htmlspecialchars($bootToken, ENT_QUOTES, 'UTF-8') ?>">
    <div class="app-shell">
        <header class="topbar">
            <h1>Shared Household List</h1>
            <div class="topbar-menu">
                <button
                    type="button"
                    id="menuButton"
                    class="menu-button"
                    aria-haspopup="true"
                    aria-expanded="false"
                    aria-controls="topbarMenu"
                    aria-label="Open menu"
                >
                    <span></span>
                    <span></span>
                    <span></span>
                </button>
                <div id="topbarMenu" class="menu-dropdown hidden" role="menu" aria-label="List options">
                    <div class="menu-section">
                        <p class="menu-label">Name</p>
                        <strong id="currentUserName">Loading...</strong>
                    </div>
                    <button type="button" id="syncStatus" class="menu-item menu-item--status" role="menuitem">
                        <span class="menu-item-copy">
                            <span class="menu-label">Status</span>
                            <span class="sync-label">Connecting</span>
                        </span>
                        <span class="sync-dot sync-dot--grey" aria-hidden="true"></span>
                    </button>
                    <button type="button" id="shareButton" class="menu-item" role="menuitem">Share List</button>
                    <button type="button" id="importCsvButton" class="menu-item" role="menuitem">Import CSV</button>
                </div>
            </div>
        </header>

        <section id="statusBanner" class="status-banner hidden" aria-live="polite"></section>

        <nav class="filter-bar" id="filterBar" aria-label="Store filters"></nav>

        <main id="listRoot" class="list-root" aria-live="polite"></main>

        <form class="add-bar" id="addForm">
            <label class="sr-only" for="itemText">Item name</label>
            <input id="itemText" name="text" type="text" maxlength="140" placeholder="Add an item" autocomplete="off">
            <label class="sr-only" for="storeSelect">Store</label>
            <select id="storeSelect" name="store"></select>
            <button type="submit" id="addButton">Add</button>
        </form>

        <nav class="tabbar" aria-label="List tabs">
            <button type="button" class="tabbar-button is-active" data-tab="active">Active List</button>
            <button type="button" class="tabbar-button" data-tab="purchased">Previously Purchased</button>
        </nav>
    </div>

    <div id="toastRoot" class="toast-root" aria-live="assertive" aria-atomic="true"></div>
    <input id="csvImportInput" type="file" accept=".csv,text/csv" class="sr-only">

    <template id="emptyStateTemplate">
        <section class="empty-state">
            <h2>Nothing here yet</h2>
            <p>Add a store item below to start the list.</p>
        </section>
    </template>

    <script>
        window.APP_BOOT = {
            stores: <?= json_encode(STORE_DEFS, JSON_UNESCAPED_SLASHES) ?>,
            bootToken: <?= json_encode($bootToken, JSON_UNESCAPED_SLASHES) ?>,
            rootPath: <?= json_encode($rootPath, JSON_UNESCAPED_SLASHES) ?>,
        };
    </script>
    <script src="<?= htmlspecialchars($rootPath . '/assets/app.js?v=' . $assetVersion, ENT_QUOTES, 'UTF-8') ?>" defer></script>
</body>
</html>
