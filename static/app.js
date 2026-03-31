let db = null;
let currentTable = null;
let cart = [];
let version = 0;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

function showScreen(id) {
  document.querySelectorAll('main .screen').forEach((el) => {
    if (el.id) el.classList.add('hidden');
  });
  const node = document.getElementById(id);
  if (node) node.classList.remove('hidden');
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.screen === id);
  });
}

function bindNav() {
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });
  showScreen('pos');
}

function bindKitchenSubtabs() {
  document.querySelectorAll('[data-subtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.subtab;
      document.querySelectorAll('[data-subtab]').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.getElementById('subtab-sales').classList.toggle('hidden', target !== 'sales');
      document.getElementById('subtab-manage').classList.toggle('hidden', target !== 'manage');
    });
  });
}

function renderLinks() {
  const base = window.location.origin;
  const customer = `${base}/customer`;
  const staff = `${base}/staff`;
  const customerNode = document.getElementById('customer-link');
  const staffNode = document.getElementById('staff-link');
  customerNode.href = customer;
  customerNode.textContent = customer;
  staffNode.href = staff;
  staffNode.textContent = staff;
}

function renderTables() {
  const grid = document.getElementById('table-grid');
  grid.innerHTML = '';
  db.tables.forEach((table) => {
    const btn = document.createElement('button');
    const occupied = table.status !== 'free' && table.status !== 'ว่าง';
    btn.className = `table-card ${occupied ? 'occupied' : ''}`;
    btn.innerHTML = `<p class="table-id">โต๊ะ ${table.id}</p><span class="badge table-status">${table.status}</span>`;
    btn.addEventListener('click', () => {
      currentTable = table.id;
      cart = [];
      document.getElementById('active-table').textContent = String(table.id);
      document.getElementById('menu-area').classList.remove('hidden');
      renderMenu();
      renderCart();
    });
    grid.appendChild(btn);
  });
}

function renderMenu() {
  const list = document.getElementById('menu-list');
  const preview = document.getElementById('menu-preview');
  list.innerHTML = '';
  if (preview) preview.innerHTML = '';

  db.menu.forEach((m) => {
    const btn = document.createElement('button');
    btn.textContent = `${m.name} - ${m.price}`;
    btn.addEventListener('click', () => {
      cart.push(m);
      renderCart();
    });
    list.appendChild(btn);

    if (preview) {
      const chip = document.createElement('span');
      chip.className = 'badge';
      chip.textContent = m.name;
      preview.appendChild(chip);
    }
  });
}

function renderCart() {
  const list = document.getElementById('cart-list');
  list.innerHTML = '';
  const total = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);

  if (!cart.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'ยังไม่มีรายการในบิลนี้';
    list.appendChild(empty);
    return;
  }

  cart.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.textContent = `${item.name} - ${item.price}`;
    list.appendChild(row);
  });
  const totalRow = document.createElement('strong');
  totalRow.textContent = `รวม ${total}`;
  list.appendChild(totalRow);
}

function renderCashier() {
  const list = document.getElementById('checkout-list');
  const count = document.getElementById('checkout-count');
  list.innerHTML = '';
  const grouped = {};
  db.orders.forEach((o) => {
    const key = `${o.target}:${o.target_id}`;
    grouped[key] = grouped[key] || [];
    grouped[key].push(...o.items);
  });

  const entries = Object.entries(grouped);
  count.textContent = `${entries.length} รายการ`;

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '🧾 ยังไม่มีคิวเช็คบิล';
    list.appendChild(empty);
    return;
  }

  entries.forEach(([key, items]) => {
    const [target, targetId] = key.split(':');
    const total = items.reduce((sum, i) => sum + Number(i.price || 0), 0);
    const btn = document.createElement('button');
    btn.className = 'list-item';
    btn.textContent = `Checkout ${target} ${targetId} (${total})`;
    btn.addEventListener('click', async () => {
      await api('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({ target, target_id: Number(targetId) }),
      });
      await loadData();
    });
    list.appendChild(btn);
  });
}

function renderOrders() {
  const list = document.getElementById('all-orders');
  list.innerHTML = '';
  db.orders.slice().reverse().forEach((order) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.textContent = `${order.id} | ${order.target} ${order.target_id} | ${order.status} | ${order.items.length} รายการ`;
    list.appendChild(row);
  });
}

function renderReport() {
  const total = db.sales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  document.getElementById('sales-total').textContent = String(total);
  document.getElementById('sale-today').textContent = String(total);
  document.getElementById('sale-week').textContent = String(total);
  document.getElementById('sale-month').textContent = String(total);
  document.getElementById('cash-total').textContent = String(total);
  document.getElementById('qr-total').textContent = '0';

  const list = document.getElementById('sales-list');
  list.innerHTML = '';

  if (!db.sales.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'ยังไม่มีประวัติการขาย';
    list.appendChild(empty);
    return;
  }

  db.sales.slice().reverse().forEach((sale) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.textContent = `${sale.id} | ${sale.target} ${sale.target_id} | ${sale.total}`;
    list.appendChild(row);
  });
}

function renderSettings() {
  document.getElementById('table-count').value = db.tableCount;
}

async function loadData() {
  const data = await api('/api/data');
  if (data.error) return;
  db = data;
  version = db.meta.version;
  renderTables();
  renderMenu();
  renderCashier();
  renderOrders();
  renderReport();
  renderSettings();
}

async function pollLive() {
  const data = await api(`/api/staff/live?since=${version}`);
  if (data.changed) {
    await loadData();
  }
}

async function checkLicense() {
  const status = await api('/api/license');
  document.getElementById('machine-id').textContent = status.machine_id || '-';
  if (status.licensed) {
    document.getElementById('license-screen').classList.add('hidden');
    await loadData();
  }
}

function bindActions() {
  document.getElementById('activate-btn').addEventListener('click', async () => {
    const key = document.getElementById('license-key').value.trim();
    const res = await api('/api/activate', { method: 'POST', body: JSON.stringify({ key }) });
    document.getElementById('license-message').textContent = res.status === 'success' ? 'Activated' : (res.message || 'Error');
    await checkLicense();
  });

  document.getElementById('submit-order').addEventListener('click', async () => {
    if (!currentTable || !cart.length) return;
    await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({ target: 'table', target_id: currentTable, cart, source: 'host' }),
    });
    cart = [];
    document.getElementById('menu-area').classList.add('hidden');
    await loadData();
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    const tableCount = Number(document.getElementById('table-count').value || 8);
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount }) });
    await loadData();
  });

  document.getElementById('reset-day').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ reset: true }) });
    await loadData();
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/sw.js').catch(() => {});
  }
}

(function init() {
  bindNav();
  bindKitchenSubtabs();
  bindActions();
  renderLinks();
  registerServiceWorker();
  checkLicense();
  setInterval(pollLive, 2500);
})();
