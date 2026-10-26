const listEl = document.getElementById('account-list');
const detailEl = document.getElementById('detail');
const searchEl = document.getElementById('search');
const formTpl = document.getElementById('account-form-tpl');

let currentId = null;

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

// datetime-local wants local time without a zone
function localInputValue(date = new Date()) {
  const off = date.getTimezoneOffset() * 60000;
  return new Date(date - off).toISOString().slice(0, 16);
}

// ---- Account list ----

async function loadList() {
  const accounts = await api(`/accounts?q=${encodeURIComponent(searchEl.value)}`);
  if (!accounts.length) {
    listEl.innerHTML = `<li class="none">${searchEl.value ? 'No matches.' : 'No accounts yet.'}</li>`;
    return;
  }
  listEl.innerHTML = accounts.map((a) => `
    <li><a href="#/account/${a.id}" class="${a.id === currentId ? 'active' : ''}">
      <div class="name">${esc(a.name)}</div>
      <div class="meta">${a.last_touch ? `Last touch ${timeAgo(a.last_touch)}` : 'No touch points yet'}</div>
    </a></li>`).join('');
}

let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadList, 150);
});

// ---- Account form (new + edit) ----

function showAccountForm(account) {
  const form = formTpl.content.firstElementChild.cloneNode(true);
  form.querySelector('h2').textContent = account ? 'Edit account' : 'New account';
  if (account) for (const f of ['name', 'address', 'phone', 'email']) form.elements[f].value = account[f];

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      const saved = account
        ? await api(`/accounts/${account.id}`, { method: 'PUT', body })
        : await api('/accounts', { method: 'POST', body });
      if (location.hash === `#/account/${saved.id}`) route();
      else location.hash = `#/account/${saved.id}`;
    } catch (err) {
      const errEl = form.querySelector('.error');
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
  form.querySelector('.cancel').addEventListener('click', () => {
    if (account) route();
    else location.hash = '';
  });

  detailEl.replaceChildren(form);
  form.elements.name.focus();
}

// ---- Account detail + notes feed ----

async function showAccount(id) {
  let account;
  try {
    account = await api(`/accounts/${id}`);
  } catch {
    detailEl.innerHTML = '<p class="empty">That account no longer exists.</p>';
    return;
  }

  const contact = [
    ['Address', esc(account.address)],
    ['Phone', account.phone && `<a href="tel:${esc(account.phone)}">${esc(account.phone)}</a>`],
    ['Email', account.email && `<a href="mailto:${esc(account.email)}">${esc(account.email)}</a>`],
  ].filter(([, v]) => v);

  detailEl.innerHTML = `
    <div class="card">
      <div class="account-head">
        <h2>${esc(account.name)}</h2>
        <div class="actions">
          <button class="edit">Edit</button>
          <button class="delete danger">Delete</button>
        </div>
      </div>
      ${contact.length
        ? `<dl class="contact">${contact.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`
        : '<p class="empty">No contact details yet.</p>'}
    </div>

    <div class="card">
      <h2>Log a touch point</h2>
      <form class="note-form">
        <textarea name="body" rows="3" placeholder="What happened? Who did you talk to, what's next?" required></textarea>
        <div class="row">
          <select name="kind">
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="visit">Visit</option>
            <option value="note">Note</option>
          </select>
          <input name="occurred_at" type="datetime-local" value="${localInputValue()}">
          <button type="submit" class="primary">Add</button>
        </div>
        <p class="error" hidden></p>
      </form>
    </div>

    <div class="card">
      <h2>Activity</h2>
      ${account.notes.length ? `<ul class="feed">${account.notes.map((n) => `
        <li>
          <div class="head">
            <span class="kind">${esc(n.kind)}</span>
            <span>${formatDate(n.occurred_at)}</span>
            <button class="link" data-note="${n.id}">Delete</button>
          </div>
          <div class="body">${esc(n.body)}</div>
        </li>`).join('')}</ul>`
        : '<p class="empty">No touch points logged yet.</p>'}
    </div>`;

  detailEl.querySelector('.edit').addEventListener('click', () => showAccountForm(account));
  detailEl.querySelector('.delete').addEventListener('click', async () => {
    if (!confirm(`Delete ${account.name} and all of its notes?`)) return;
    await api(`/accounts/${account.id}`, { method: 'DELETE' });
    location.hash = '';
  });

  const noteForm = detailEl.querySelector('.note-form');
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { body, kind, occurred_at } = Object.fromEntries(new FormData(noteForm));
    try {
      await api(`/accounts/${account.id}/notes`, {
        method: 'POST',
        body: { body, kind, occurred_at: occurred_at ? new Date(occurred_at).toISOString() : undefined },
      });
      await Promise.all([showAccount(account.id), loadList()]);
    } catch (err) {
      const errEl = noteForm.querySelector('.error');
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  detailEl.querySelectorAll('[data-note]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this note?')) return;
    await api(`/notes/${btn.dataset.note}`, { method: 'DELETE' });
    await Promise.all([showAccount(account.id), loadList()]);
  }));
}

// ---- Routing ----

async function route() {
  const match = location.hash.match(/^#\/account\/(\d+)$/);
  currentId = match ? Number(match[1]) : null;
  await loadList();
  if (currentId) await showAccount(currentId);
  else detailEl.innerHTML = '<p class="empty">Select an account, or add a new one.</p>';
}

document.getElementById('new-account').addEventListener('click', () => showAccountForm(null));
window.addEventListener('hashchange', route);
route();
