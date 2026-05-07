const adminKey = document.body.dataset.adminKey;
const rootPath = window.ADMIN_BOOT.rootPath || '';
const ui = {
  userForm: document.getElementById('userForm'),
  displayName: document.getElementById('displayName'),
  userList: document.getElementById('userList'),
  newUserPanel: document.getElementById('newUserPanel'),
  userCountText: document.getElementById('userCountText'),
  toastRoot: document.getElementById('toastRoot'),
};

init();

function init() {
  ui.userForm.addEventListener('submit', onCreateUser);
  loadUsers();
}

async function loadUsers() {
  try {
    const data = await api('/api/users.php');
    renderUsers(data.users, data.active_count, data.max_users);
  } catch (error) {
    toast(error.message || 'Could not load users.');
  }
}

function renderUsers(users, activeCount, maxUsers) {
  ui.userCountText.textContent = `${activeCount} of ${maxUsers} users active`;
  ui.userList.innerHTML = users
    .map((user) => `
      <article class="admin-user-row">
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <div class="admin-user-meta">
            Created ${formatDateTime(user.created_at)}
            ${user.last_active_at ? ` · Last active ${formatDateTime(user.last_active_at)}` : ' · Never opened'}
          </div>
        </div>
        <div class="admin-user-actions">
          <button type="button" data-copy-user-id="${user.id}">Copy Link</button>
          <button type="button" data-regenerate-user-id="${user.id}">Regenerate Link</button>
          <button type="button" data-remove-user-id="${user.id}">Remove</button>
        </div>
      </article>
    `)
    .join('');

  [...ui.userList.querySelectorAll('button[data-copy-user-id]')].forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.copyUserId;
      const user = users.find((entry) => entry.id === userId);
      if (!user?.current_link) {
        toast('No active link available.');
        return;
      }
      await navigator.clipboard.writeText(user.current_link);
      toast('Link copied.');
    });
  });

  [...ui.userList.querySelectorAll('button[data-regenerate-user-id]')].forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.regenerateUserId;
      const userName = users.find((user) => user.id === userId)?.name || 'this user';
      if (!window.confirm(`Regenerate ${userName}'s link? Their old link will stop working.`)) {
        return;
      }
      try {
        const data = await api('/api/users.php', { method: 'PATCH', body: { id: userId, action: 'regenerate_link' } });
        await navigator.clipboard.writeText(data.link);
        ui.newUserPanel.classList.remove('hidden');
        ui.newUserPanel.innerHTML = `
          <strong>${escapeHtml(data.user.name)}</strong>
          <div>New private link:</div>
          <code>${escapeHtml(data.link)}</code>
          <div style="margin-top:10px;">
            <button type="button" id="copyNewLink">Copy Link</button>
          </div>
        `;
        document.getElementById('copyNewLink').addEventListener('click', async () => {
          await navigator.clipboard.writeText(data.link);
          toast('Link copied.');
        });
        toast('New link generated and copied.');
        await loadUsers();
      } catch (error) {
        toast(error.message || 'Could not regenerate link.');
      }
    });
  });

  [...ui.userList.querySelectorAll('button[data-remove-user-id]')].forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.removeUserId;
      const userName = users.find((user) => user.id === userId)?.name || 'this user';
      if (!window.confirm(`Remove ${userName}? Their link will stop working.`)) {
        return;
      }
      try {
        await api('/api/users.php', { method: 'DELETE', body: { id: userId } });
        toast('User removed.');
        await loadUsers();
      } catch (error) {
        toast(error.message || 'Could not remove user.');
      }
    });
  });
}

async function onCreateUser(event) {
  event.preventDefault();
  const name = ui.displayName.value.trim();
  if (!name) return;

  try {
    const data = await api('/api/users.php', { method: 'POST', body: { name } });
    ui.displayName.value = '';
    ui.newUserPanel.classList.remove('hidden');
    ui.newUserPanel.innerHTML = `
      <strong>${escapeHtml(data.user.name)}</strong>
      <div>Share this private link:</div>
      <code>${escapeHtml(data.link)}</code>
      <div style="margin-top:10px;">
        <button type="button" id="copyNewLink">Copy Link</button>
      </div>
    `;
    document.getElementById('copyNewLink').addEventListener('click', async () => {
      await navigator.clipboard.writeText(data.link);
      toast('Link copied.');
    });
    toast('User created.');
    await loadUsers();
  } catch (error) {
    toast(error.message || 'Could not create user.');
  }
}

async function api(url, options = {}) {
  const normalizedUrl = `${rootPath}${url}?key=${encodeURIComponent(adminKey)}`;
  const init = {
    method: options.method || 'GET',
    headers: {
      'X-Admin-Key': adminKey,
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

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  ui.toastRoot.append(element);
  window.setTimeout(() => element.remove(), 2800);
}
