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
}

function bindNav() {
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
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
    btn.textContent = `โต๊ะ ${table.id} (${table.status})`;
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
  list.innerHTML = '';
  db.menu.forEach((m) => {
    const btn = document.createElement('button');
    btn.textContent = `${m.name} - ${m.price}`;
    btn.addEventListener('click', () => {
      cart.push(m);
      renderCart();
    });
    list.appendChild(btn);
  });
}

function renderCart() {
  const list = document.getElementById('cart-list');
  list.innerHTML = '';
  const total = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
  cart.forEach((item) => {
    const row = document.createElement('div');
    row.textContent = `${item.name} - ${item.price}`;
    list.appendChild(row);
  });
  const totalRow = document.createElement('strong');
  totalRow.textContent = `รวม ${total}`;
  list.appendChild(totalRow);
}

function renderCashier() {
  const list = document.getElementById('checkout-list');
  list.innerHTML = '';
  const grouped = {};
  db.orders.forEach((o) => {
    const key = `${o.target}:${o.target_id}`;
    grouped[key] = grouped[key] || [];
    grouped[key].push(...o.items);
  });

  Object.entries(grouped).forEach(([key, items]) => {
    const [target, targetId] = key.split(':');
    const total = items.reduce((sum, i) => sum + Number(i.price || 0), 0);
    const btn = document.createElement('button');
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
  const list = document.getElementById('sales-list');
  list.innerHTML = '';
  db.sales.slice().reverse().forEach((sale) => {
    const row = document.createElement('div');
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

(function init() {
  bindNav();
  bindActions();
  renderLinks();
  checkLicense();
  setInterval(pollLive, 2500);
})();
