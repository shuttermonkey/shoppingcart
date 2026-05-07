const STORAGE_KEYS = {
  token: 'shopping-list-token',
  filter: 'shopping-list-filter',
  cache: 'shopping-list-cache',
};

const state = {
  token: '',
  currentUser: null,
  usersById: {},
  items: [],
  filter: localStorage.getItem(STORAGE_KEYS.filter) || 'all',
  tab: 'active',
  detailItemId: null,
  editingItemId: null,
  sync: {
    lastSyncAt: 0,
    isSyncing: false,
    stale: false,
  },
  offline: !navigator.onLine,
  lastFingerprint: null,
  idleSince: Date.now(),
};

const stores = window.APP_BOOT.stores;
const bootToken = window.APP_BOOT.bootToken || '';
const rootPath = window.APP_BOOT.rootPath || '';
const completedRetentionSeconds = 24 * 60 * 60;

const ui = {
  menuButton: document.getElementById('menuButton'),
  topbarMenu: document.getElementById('topbarMenu'),
  syncStatus: document.getElementById('syncStatus'),
  statusBanner: document.getElementById('statusBanner'),
  currentUserName: document.getElementById('currentUserName'),
  filterBar: document.getElementById('filterBar'),
  listRoot: document.getElementById('listRoot'),
  addForm: document.getElementById('addForm'),
  itemText: document.getElementById('itemText'),
  storeSelect: document.getElementById('storeSelect'),
  addButton: document.getElementById('addButton'),
  toastRoot: document.getElementById('toastRoot'),
  shareButton: document.getElementById('shareButton'),
  importCsvButton: document.getElementById('importCsvButton'),
  csvImportInput: document.getElementById('csvImportInput'),
};

const tabButtons = [...document.querySelectorAll('.tabbar-button')];

init();

async function init() {
  hydrateToken();
  populateStoreSelect();
  renderFilters();
  bindEvents();
  hydrateCache();
  render();
  registerServiceWorker();

  if (!state.token) {
    showBanner('No personal user link found. Open the app from your family link.', 'warn');
    setComposerDisabled(true, 'No link loaded.');
    return;
  }

  await fullSync(true);
  schedulePolling();
}

function hydrateToken() {
  const saved = localStorage.getItem(STORAGE_KEYS.token);
  state.token = bootToken || saved || '';
  if (bootToken) {
    localStorage.setItem(STORAGE_KEYS.token, bootToken);
  }
}

function hydrateCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.cache);
  if (!raw) return;
  try {
    const cached = JSON.parse(raw);
    state.items = cached.items || [];
    state.usersById = indexUsers(cached.users || []);
    state.currentUser = cached.currentUser || state.currentUser;
    state.lastFingerprint = cached.last_modified || null;
  } catch (error) {
    console.error(error);
  }
}

function cacheSnapshot() {
  localStorage.setItem(
    STORAGE_KEYS.cache,
    JSON.stringify({
      items: state.items,
      users: Object.values(state.usersById),
      currentUser: state.currentUser,
      last_modified: state.lastFingerprint,
      cached_at: Date.now(),
    }),
  );
}

function bindEvents() {
  ui.addForm.addEventListener('submit', onAddItem);
  ui.shareButton.addEventListener('click', onShare);
  ui.menuButton.addEventListener('click', toggleMenu);
  ui.importCsvButton.addEventListener('click', () => {
    closeMenu();
    ui.csvImportInput.click();
  });
  ui.csvImportInput.addEventListener('change', onImportCsv);
  ui.syncStatus.setAttribute('role', 'button');
  ui.syncStatus.setAttribute('title', 'Refresh app');
  ui.syncStatus.addEventListener('click', onManualRefresh);
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      tabButtons.forEach((node) => node.classList.toggle('is-active', node === button));
      render();
    });
  });

  window.addEventListener('online', async () => {
    state.offline = false;
    await fullSync(true);
    render();
  });

  window.addEventListener('offline', () => {
    state.offline = true;
    render();
  });

  ['visibilitychange', 'pointerdown', 'keydown', 'focus'].forEach((eventName) => {
    window.addEventListener(eventName, () => {
      state.idleSince = Date.now();
    });
  });

  document.addEventListener('click', (event) => {
    if (!ui.topbarMenu.contains(event.target) && !ui.menuButton.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  });
}

function populateStoreSelect() {
  ui.storeSelect.innerHTML = Object.entries(stores)
    .map(([key, store]) => `<option value="${key}">${store.short}</option>`)
    .join('');

  if (state.filter !== 'all' && stores[state.filter]) {
    ui.storeSelect.value = state.filter;
  }
}

function renderFilters() {
  const buttons = [
    '<button type="button" class="filter-pill" data-filter="all">All</button>',
    ...Object.entries(stores).map(
      ([key, store]) => `<button type="button" class="filter-pill" data-filter="${key}">${store.short}</button>`,
    ),
  ];
  ui.filterBar.innerHTML = buttons.join('');
  [...ui.filterBar.querySelectorAll('.filter-pill')].forEach((button) => {
    button.classList.toggle('is-active', button.dataset.filter === state.filter);
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      localStorage.setItem(STORAGE_KEYS.filter, state.filter);
      if (state.filter !== 'all') {
        ui.storeSelect.value = state.filter;
      }
      renderFilters();
      render();
    });
  });
}

function render() {
  renderCurrentUser();
  renderStatus();
  setComposerDisabled(state.offline || !state.token, state.offline ? 'No connection — reconnect to add items' : '');

  const items = state.tab === 'active' ? getActiveItems() : getPurchasedItems();
  if (items.length === 0) {
    const template = document.getElementById('emptyStateTemplate');
    ui.listRoot.innerHTML = template.innerHTML;
    return;
  }

  const html = state.filter === 'all'
    ? renderGroupedItems(items)
    : renderFlatItems(items);
  ui.listRoot.innerHTML = html;
  wireListEvents();
}

function renderCurrentUser() {
  ui.currentUserName.textContent = state.currentUser ? state.currentUser.name : 'Unknown';
}

function renderStatus() {
  const syncLabel = ui.syncStatus.querySelector('.sync-label');
  const syncDot = ui.syncStatus.querySelector('.sync-dot');
  syncDot.className = 'sync-dot';

  const secondsSince = state.sync.lastSyncAt ? Math.floor((Date.now() - state.sync.lastSyncAt) / 1000) : null;
  const stale = secondsSince !== null && secondsSince > 60;
  state.sync.stale = stale;

  if (state.sync.isSyncing) {
    syncDot.classList.add('sync-dot--grey');
    syncLabel.textContent = 'Syncing';
  } else if (stale) {
    syncDot.classList.add('sync-dot--orange');
    syncLabel.textContent = 'Stale';
  } else {
    syncDot.classList.add('sync-dot--green');
    syncLabel.textContent = 'Fresh';
  }

  if (state.offline) {
    const cachedAt = JSON.parse(localStorage.getItem(STORAGE_KEYS.cache) || '{}').cached_at;
    showBanner(`Offline — showing data from ${cachedAt ? formatDateTime(Math.floor(cachedAt / 1000)) : 'cache'}`, 'offline');
  } else if (stale) {
    showBanner(`Data may be outdated — last synced ${relativeTime(Math.floor(state.sync.lastSyncAt / 1000))}`, 'warn');
  } else {
    hideBanner();
  }
}

function toggleMenu() {
  const isOpen = !ui.topbarMenu.classList.contains('hidden');
  if (isOpen) {
    closeMenu();
    return;
  }

  ui.topbarMenu.classList.remove('hidden');
  ui.menuButton.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  ui.topbarMenu.classList.add('hidden');
  ui.menuButton.setAttribute('aria-expanded', 'false');
}

function showBanner(message, kind) {
  ui.statusBanner.textContent = message;
  ui.statusBanner.className = `status-banner status-banner--${kind}`;
}

async function onManualRefresh() {
  if (state.sync.isSyncing) return;
  closeMenu();

  const label = ui.syncStatus.querySelector('.sync-label');
  if (label) {
    label.textContent = 'Refreshing';
  }

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.error(error);
  }

  window.location.reload();
}

function hideBanner() {
  ui.statusBanner.className = 'status-banner hidden';
  ui.statusBanner.textContent = '';
}

function setComposerDisabled(disabled, title = '') {
  ui.addForm.classList.toggle('is-disabled', disabled);
  ui.itemText.disabled = disabled;
  ui.storeSelect.disabled = disabled;
  ui.addButton.disabled = disabled;
  ui.addForm.title = title;
}

function getActiveItems() {
  const now = Math.floor(Date.now() / 1000);
  return state.items.filter((item) => {
    if (state.filter !== 'all' && item.store !== state.filter) return false;
    if (!item.completed_at) return true;
    return now - item.completed_at < completedRetentionSeconds;
  });
}

function getPurchasedItems() {
  const now = Math.floor(Date.now() / 1000);
  return state.items
    .filter((item) => {
      if (state.filter !== 'all' && item.store !== state.filter) return false;
      return item.completed_at && now - item.completed_at >= completedRetentionSeconds;
    })
    .sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0));
}

function renderGroupedItems(items) {
  const grouped = new Map();
  items.forEach((item) => {
    const bucket = grouped.get(item.store) || [];
    bucket.push(item);
    grouped.set(item.store, bucket);
  });

  return [...grouped.entries()]
    .map(([storeKey, storeItems]) => {
      const store = stores[storeKey];
      return `
        <section class="store-group">
          <div class="store-header">${store.label}</div>
          ${storeItems.map((item) => renderItem(item, true)).join('')}
        </section>
      `;
    })
    .join('');
}

function renderFlatItems(items) {
  return `<section class="store-group">${items.map((item) => renderItem(item, false)).join('')}</section>`;
}

function renderItem(item, showStore) {
  const store = stores[item.store];
  const complete = Boolean(item.completed_at);
  const detailOpen = state.detailItemId === item.id;
  return `
    <article class="item-row" data-item-id="${item.id}">
      <div class="item-main">
        <button type="button" class="item-check ${complete ? 'is-complete' : ''}" data-action="toggle-complete" aria-label="${complete ? 'Mark active' : 'Mark complete'}">
          ${complete ? '&#10003;' : ''}
        </button>
        <div class="item-body">
          <p class="item-title ${complete ? 'is-complete' : ''}">${escapeHtml(item.text)}</p>
          <div class="item-meta">
            ${showStore ? `<span class="store-badge" style="background:${store.color}">${store.short}</span>` : ''}
            <span class="user-chip" style="background:${item.added_by_color}">${escapeHtml(item.added_by_name)}</span>
            <span>${relativeTime(item.added_at)}</span>
          </div>
        </div>
      </div>
      ${detailOpen ? renderItemDetail(item, store) : ''}
    </article>
  `;
}

function renderItemDetail(item, store) {
  const isEditing = state.editingItemId === item.id;
  const canReadd = state.tab === 'purchased';
  return `
    <div class="item-detail">
      <div><strong>${escapeHtml(item.text)}</strong></div>
      <div>Store: ${store.label}</div>
      <div>Added by ${escapeHtml(item.added_by_name)} on ${formatDateTime(item.added_at)}</div>
      ${item.updated_at ? `<div>Last edited ${formatDateTime(item.updated_at)}</div>` : ''}
      ${item.completed_at ? `<div>Completed by ${escapeHtml(item.completed_by_name || 'Unknown')} on ${formatDateTime(item.completed_at)}</div>` : ''}
      ${isEditing ? renderEditForm(item) : `
        <div class="item-detail-actions">
          ${canReadd ? '<button type="button" class="detail-action" data-action="readd">Re-add</button>' : ''}
          <button type="button" class="detail-action" data-action="edit">Edit</button>
          <button type="button" class="detail-action detail-action--danger" data-action="delete">Delete</button>
        </div>
      `}
    </div>
  `;
}

function renderEditForm(item) {
  const options = Object.entries(stores)
    .map(([key, store]) => `
      <option value="${key}" ${key === item.store ? 'selected' : ''}>${escapeHtml(store.label)}</option>
    `)
    .join('');

  return `
    <form class="item-edit-form" data-item-id="${item.id}">
      <div class="item-edit-fields">
        <label class="sr-only" for="edit-item-text-${item.id}">Item</label>
        <input id="edit-item-text-${item.id}" type="text" name="text" maxlength="140" value="${escapeHtml(item.text)}" required placeholder="Add an item">
        <label class="sr-only" for="edit-item-store-${item.id}">Store</label>
        <select id="edit-item-store-${item.id}" name="store">${options}</select>
      </div>
      <div class="item-edit-actions">
        <button type="submit" class="detail-action">Save</button>
        <button type="button" class="detail-action detail-action--secondary" data-action="cancel-edit">Cancel</button>
      </div>
    </form>
  `;
}

function wireListEvents() {
  [...ui.listRoot.querySelectorAll('.item-row')].forEach((row) => {
    const itemId = Number(row.dataset.itemId);
    row.addEventListener('click', (event) => {
      if (isInteractiveRowTarget(event.target)) return;
      state.editingItemId = null;
      state.detailItemId = state.detailItemId === itemId ? null : itemId;
      render();
    });

    row.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      button.addEventListener('click', () => {
        if (action === 'toggle-complete') {
          toggleComplete(itemId);
        } else if (action === 'edit') {
          startEditingItem(itemId);
        } else if (action === 'cancel-edit') {
          stopEditingItem();
        } else if (action === 'delete') {
          removeItem(itemId);
        } else if (action === 'readd') {
          readdItem(itemId);
        }
      });
    });

    const editForm = row.querySelector('.item-edit-form');
    if (editForm) {
      editForm.addEventListener('submit', (event) => {
        onEditItem(event, itemId);
      });
    }
  });
}

function isInteractiveRowTarget(target) {
  return Boolean(target instanceof Element && target.closest('button, input, select, textarea, label, form, [data-action], .item-check'));
}

function startEditingItem(itemId) {
  state.detailItemId = itemId;
  state.editingItemId = itemId;
  render();
}

function stopEditingItem() {
  state.editingItemId = null;
  render();
}

async function onAddItem(event) {
  event.preventDefault();
  const text = ui.itemText.value.trim();
  const store = ui.storeSelect.value;
  if (!text || state.offline) return;

  const optimisticId = `temp-${Date.now()}`;
  const optimisticItem = {
    id: optimisticId,
    text,
    store,
    added_by: state.currentUser.id,
    added_by_name: state.currentUser.name,
    added_by_color: state.currentUser.color,
    added_at: Math.floor(Date.now() / 1000),
    completed_by: null,
    completed_at: null,
  };

  state.items.unshift(optimisticItem);
  ui.itemText.value = '';
  render();

  try {
    const response = await api('/api/items.php', {
      method: 'POST',
      body: { text, store },
    });
    state.items = state.items.filter((item) => item.id !== optimisticId);
    state.items.unshift(response.item);
    state.lastFingerprint = response.last_modified;
    cacheSnapshot();
    render();
    fullSync();
  } catch (error) {
    state.items = state.items.filter((item) => item.id !== optimisticId);
    render();
    toast(error.message || 'Could not add item.');
  }
}

async function toggleComplete(itemId) {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index === -1 || state.offline) return;

  const original = { ...state.items[index] };
  state.items[index] = {
    ...state.items[index],
    completed_by: state.items[index].completed_at ? null : state.currentUser.id,
    completed_by_name: state.items[index].completed_at ? null : state.currentUser.name,
    completed_at: state.items[index].completed_at ? null : Math.floor(Date.now() / 1000),
  };
  render();

  try {
    const response = await api('/api/items.php', {
      method: 'PATCH',
      body: { id: itemId, action: 'toggle_complete' },
    });
    state.items[index] = response.item;
    state.lastFingerprint = response.last_modified;
    cacheSnapshot();
    render();
  } catch (error) {
    state.items[index] = original;
    render();
    toast(error.message || 'Could not update item.');
  }
}

async function removeItem(itemId) {
  if (state.offline) return;
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) return;

  if (state.detailItemId === itemId) {
    state.detailItemId = null;
  }
  if (state.editingItemId === itemId) {
    state.editingItemId = null;
  }
  state.items = state.items.filter((entry) => entry.id !== itemId);
  render();

  try {
    await api('/api/items.php', {
      method: 'PATCH',
      body: { id: itemId, action: 'delete' },
    });
    cacheSnapshot();
    const undoToast = toast('Item removed', 'Undo', async () => {
      await api('/api/items.php', {
        method: 'PATCH',
        body: { id: itemId, action: 'undo_delete' },
      });
      state.items.unshift(item);
      render();
      cacheSnapshot();
    }, 5000);
    setTimeout(() => undoToast.remove(), 5000);
  } catch (error) {
    state.items.unshift(item);
    render();
    toast(error.message || 'Could not delete item.');
  }
}

async function readdItem(itemId) {
  if (state.offline) return;
  try {
    const response = await api('/api/items.php', {
      method: 'PATCH',
      body: { id: itemId, action: 'readd' },
    });
    state.items.unshift(response.item);
    state.tab = 'active';
    tabButtons.forEach((node) => node.classList.toggle('is-active', node.dataset.tab === 'active'));
    cacheSnapshot();
    render();
    toast('Item added back to active list.');
  } catch (error) {
    toast(error.message || 'Could not re-add item.');
  }
}

async function onEditItem(event, itemId) {
  event.preventDefault();
  if (state.offline) return;

  const form = event.currentTarget;
  const formData = new FormData(form);
  const text = String(formData.get('text') || '').trim();
  const store = String(formData.get('store') || '');
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index === -1) return;
  if (!text) {
    toast('Item text is required.');
    return;
  }

  const original = { ...state.items[index] };
  state.items[index] = {
    ...state.items[index],
    text,
    store,
    updated_at: Math.floor(Date.now() / 1000),
  };
  render();

  try {
    const response = await api('/api/items.php', {
      method: 'PATCH',
      body: { id: itemId, action: 'edit', text, store },
    });
    state.items[index] = response.item;
    state.lastFingerprint = response.last_modified;
    state.editingItemId = null;
    cacheSnapshot();
    render();
  } catch (error) {
    state.items[index] = original;
    render();
    toast(error.message || 'Could not save item.');
  }
}

async function onShare() {
  closeMenu();
  const lines = getActiveItems().map((item) => {
    const prefix = state.filter === 'all' ? `[${stores[item.store].short}] ` : '';
    return `${prefix}${item.text}`;
  });

  const text = lines.length ? lines.join('\n') : 'The shopping list is currently empty.';
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Family Shopping List', text });
      return;
    } catch (error) {
      console.error(error);
    }
  }

  await navigator.clipboard.writeText(text);
  toast('Shopping list copied to clipboard.');
}

async function onImportCsv(event) {
  const [file] = event.target.files || [];
  event.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    const imported = normalizeImportedRows(rows);

    if (imported.length === 0) {
      throw new Error('No valid items found in the CSV.');
    }

    await importItems(imported);
    toast(`Imported ${imported.length} item${imported.length === 1 ? '' : 's'}.`);
    await fullSync(true);
  } catch (error) {
    toast(error.message || 'Could not import CSV.');
  }
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(value);
      value = '';
      if (row.some((cell) => cell.trim() !== '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    value += char;
  }

  if (inQuotes) {
    throw new Error('CSV file is not formatted correctly.');
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== '')) {
    rows.push(row);
  }

  return rows;
}

function normalizeImportedRows(rows) {
  if (!rows.length) {
    throw new Error('CSV file is empty.');
  }

  rows.forEach((row) => {
    if (row.length !== 2) {
      throw new Error('CSV must contain exactly two columns: Store and Item.');
    }
  });

  const [firstRow, ...restRows] = rows;
  const hasHeader = isHeaderRow(firstRow);
  const dataRows = hasHeader ? restRows : rows;

  if (!dataRows.length) {
    throw new Error('CSV does not contain any item rows.');
  }

  let recognizedStoreCount = 0;
  const items = dataRows.map((row, index) => {
    const storeName = row[0].trim();
    const itemName = row[1].trim();
    if (!itemName) {
      throw new Error(`Row ${index + (hasHeader ? 2 : 1)} is missing an item name.`);
    }

    const matchedStore = matchImportedStore(storeName);
    if (matchedStore) {
      recognizedStoreCount += 1;
      return { text: itemName.slice(0, 140), store: matchedStore };
    }

    const label = storeName ? ` (${storeName})` : '';
    return {
      text: `${itemName}${label}`.slice(0, 140),
      store: 'other',
    };
  });

  if (recognizedStoreCount === 0) {
    throw new Error('No stores in the first column matched the known store list.');
  }

  return items;
}

function isHeaderRow(row) {
  return row.length === 2
    && row[0].trim().toLowerCase() === 'store'
    && row[1].trim().toLowerCase() === 'item';
}

function matchImportedStore(value) {
  const normalized = normalizeStoreName(value);
  if (!normalized) return null;

  for (const [key, store] of Object.entries(stores)) {
    const candidates = [key, store.label, store.short];
    if (candidates.some((candidate) => normalizeStoreName(candidate) === normalized)) {
      return key;
    }
  }

  return null;
}

function normalizeStoreName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

async function importItems(items) {
  for (const item of items) {
    await api('/api/items.php', {
      method: 'POST',
      body: item,
    });
  }
}

async function fullSync(force = false) {
  if (!state.token || (state.offline && !force)) return;
  state.sync.isSyncing = true;
  renderStatus();

  try {
    const response = await api('/api/items.php');
    syncStores(response.meta?.stores);
    state.currentUser = response.current_user;
    state.usersById = indexUsers(response.users);
    state.items = response.items;
    state.lastFingerprint = response.meta.last_modified;
    state.sync.lastSyncAt = Date.now();
    state.offline = false;
    cacheSnapshot();
    render();
  } catch (error) {
    state.offline = !navigator.onLine;
    if (!state.offline) {
      toast(error.message || 'Sync failed.');
    }
  } finally {
    state.sync.isSyncing = false;
    renderStatus();
  }
}

function syncStores(nextStores) {
  if (!nextStores || typeof nextStores !== 'object') return;

  Object.keys(stores).forEach((key) => {
    if (!(key in nextStores)) {
      delete stores[key];
    }
  });
  Object.assign(stores, nextStores);

  if (state.filter !== 'all' && !stores[state.filter]) {
    state.filter = 'all';
    localStorage.setItem(STORAGE_KEYS.filter, state.filter);
  }

  populateStoreSelect();
  renderFilters();
}

function schedulePolling() {
  const tick = async () => {
    const idleMs = Date.now() - state.idleSince;
    const delay = document.hidden || idleMs > 5 * 60 * 1000 ? 30000 : 10000;

    if (!state.offline && state.token) {
      try {
        const sync = await api('/api/sync.php');
        if (
          state.lastFingerprint === null ||
          sync.last_modified !== state.lastFingerprint ||
          sync.item_count !== state.items.length
        ) {
          await fullSync();
        } else {
          state.sync.lastSyncAt = Date.now();
          renderStatus();
        }
      } catch (error) {
        renderStatus();
      }
    }

    window.setTimeout(tick, delay);
  };

  window.setTimeout(tick, 10000);
}

async function api(url, options = {}) {
  const normalizedUrl = `${rootPath}${url}`;
  const init = {
    method: options.method || 'GET',
    headers: {
      'X-User-Token': state.token,
    },
  };

  if (options.body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(normalizedUrl, init);
  const data = await response.json().catch(() => ({ ok: false, error: 'Unexpected server response.' }));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

function indexUsers(users) {
  return users.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {});
}

function relativeTime(timestamp) {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function formatDateTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toast(message, actionLabel, actionHandler, timeout = 3200) {
  const element = document.createElement('div');
  element.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  element.append(text);

  if (actionLabel && actionHandler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', async () => {
      await actionHandler();
      element.remove();
    });
    element.append(button);
  }

  ui.toastRoot.append(element);
  window.setTimeout(() => element.remove(), timeout);
  return element;
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register(`${rootPath}/sw.js`);
    } catch (error) {
      console.error(error);
    }
  }
}
