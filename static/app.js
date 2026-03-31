let db = null;
let currentTable = null;
let cart = [];

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');

  document.querySelectorAll('.tabs .tab').forEach((el) => el.classList.remove('is-active'));
  const activeTab = document.querySelector(`.tabs .tab[data-screen="${id}"]`);
  if (activeTab) activeTab.classList.add('is-active');
}

function bindNav() {
  document.querySelectorAll('nav button[data-screen]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });
}

function renderTables() {
  const grid = document.getElementById('table-grid');
  grid.innerHTML = '';
  db.tables.forEach((t) => {
    const btn = document.createElement('button');
    btn.textContent = `โต๊ะ ${t.id} (${t.status})`;
    btn.addEventListener('click', () => {
      currentTable = t.id;
      cart = [];
      document.getElementById('active-table').textContent = String(t.id);
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
  const total = cart.reduce((sum, i) => sum + Number(i.price || 0), 0);
  cart.forEach((item) => {
    const row = document.createElement('div');
    row.textContent = `${item.name} ${item.price}`;
    list.appendChild(row);
  });
  const totalRow = document.createElement('strong');
  totalRow.textContent = `รวม ${total}`;
  list.appendChild(totalRow);
}

function renderCashier() {
  const list = document.getElementById('checkout-list');
  list.innerHTML = '';
  db.tables.filter((t) => t.items.length).forEach((t) => {
    const total = t.items.reduce((sum, i) => sum + Number(i.price || 0), 0);
    const btn = document.createElement('button');
    btn.textContent = `เช็คบิลโต๊ะ ${t.id} (${total})`;
    btn.addEventListener('click', async () => {
      await api('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          table_id: t.id,
          sale_record: { table_id: t.id, total, items: t.items },
        }),
      });
      await loadData();
    });
    list.appendChild(btn);
  });
}

function renderReport() {
  const total = db.sales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  document.getElementById('sales-total').textContent = String(total);
}

async function loadData() {
  db = await api('/api/data');
  if (db.error) return;
  renderTables();
  renderCashier();
  renderReport();
}

function bindActions() {
  document.getElementById('submit-order').addEventListener('click', async () => {
    if (!currentTable || !cart.length) return;
    await api('/api/order', { method: 'POST', body: JSON.stringify({ table_id: currentTable, cart }) });
    document.getElementById('menu-area').classList.add('hidden');
    await loadData();
  });

  document.getElementById('reset-day').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ reset: true }) });
    await loadData();
  });

  const qr = document.getElementById('qr-modal');
  document.getElementById('show-qr').addEventListener('click', () => {
    const base = window.location.origin;
    document.getElementById('order-url').textContent = `${base}/?mode=order`;
    document.getElementById('cashier-url').textContent = `${base}/?mode=cashier`;
    qr.classList.remove('hidden');
  });
  document.getElementById('close-qr').addEventListener('click', () => qr.classList.add('hidden'));
}

(async function init() {
  bindNav();
  bindActions();

  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode && ['order', 'cashier', 'report'].includes(mode)) {
    showScreen(mode);
  }

  await loadData();
})();
