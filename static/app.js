let db;
let version = 0;
let menuEditIndex = -1;
let filteredSales = [];
const ADMIN_SESSION_KEY = 'fakdu_admin_logged_in';
let isAdminAuthenticated = localStorage.getItem(ADMIN_SESSION_KEY) === '1';

const statusMap = {
  available: { label: 'ว่าง', note: 'พร้อมรับลูกค้า' },
  pending_order: { label: 'มีออร์เดอร์ใหม่', note: 'รอพนักงานรับออร์เดอร์' },
  accepted_order: { label: 'รับออร์เดอร์แล้ว', note: 'กำลังเตรียมอาหาร' },
  checkout_requested: { label: 'รอเช็คบิล', note: 'ลูกค้าเรียกชำระเงิน' },
};

const qs = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString('th-TH');

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  return res.json();
}

function showScreen(id) {
  if (['backstore', 'system'].includes(id) && !ensureAdminSession()) return;
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  qs(id).classList.remove('hidden');
  document.querySelectorAll('[data-screen]').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === id));
}

function getAdminPin() {
  return String(db?.settings?.adminPin || '2468').trim();
}

function ensureAdminSession() {
  if (isAdminAuthenticated) return true;
  const pin = window.prompt('กรุณาใส่รหัส Admin');
  if (pin === null) return false;
  if (pin.trim() === getAdminPin()) {
    isAdminAuthenticated = true;
    localStorage.setItem(ADMIN_SESSION_KEY, '1');
    return true;
  }
  window.alert('รหัส Admin ไม่ถูกต้อง');
  return false;
}

function logoutAdmin() {
  isAdminAuthenticated = false;
  localStorage.removeItem(ADMIN_SESSION_KEY);
  showScreen('customer');
}

function renderTables() {
  const grid = qs('table-grid');
  grid.innerHTML = '';
  db.tables.forEach((table) => {
    const meta = statusMap[table.status] || statusMap.available;
    const card = document.createElement('div');
    card.className = `table-card ${table.status}`;
    card.innerHTML = `<p class="table-no">${table.id}</p><span class="pill">${meta.label}</span><div class="table-note">${meta.note}</div>${table.status === 'pending_order' ? '<div class="alert-dot">● New Order</div>' : ''}`;
    card.addEventListener('dblclick', async () => {
      if (table.status === 'pending_order') {
        await api('/api/table/accept', { method: 'POST', body: JSON.stringify({ table_id: table.id }) });
        await loadData();
      }
    });
    grid.appendChild(card);
  });
}

function renderCashier() {
  const wrap = qs('checkout-list');
  wrap.innerHTML = '';
  const queues = db.tables.filter((t) => t.status === 'checkout_requested');
  qs('checkout-count').textContent = `${queues.length} รายการ`;
  if (!queues.length) {
    wrap.innerHTML = '<div class="empty">ยังไม่มีคิวเช็คบิล</div>';
    return;
  }
  queues.forEach((table) => {
    const items = db.orders.filter((o) => o.target_id === table.id).flatMap((o) => o.items || []);
    const total = items.reduce((s, i) => s + Number(i.price || 0), 0);
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `<strong>โต๊ะ ${table.id}</strong><div>รวม ${money(total)} บาท</div><div class="manage-row"><button class="btn-soft" data-m="cash">เงินสด</button><button class="btn-soft" data-m="qr">QR</button></div>`;
    row.querySelectorAll('button[data-m]').forEach((btn) => btn.addEventListener('click', async () => {
      await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: table.id, payment_method: btn.dataset.m }) });
      await loadData();
    }));
    wrap.appendChild(row);
  });
}

function applySalesFilter() {
  const from = qs('date-from').value ? new Date(`${qs('date-from').value}T00:00:00`) : null;
  const to = qs('date-to').value ? new Date(`${qs('date-to').value}T23:59:59`) : null;
  filteredSales = db.sales.filter((s) => {
    const d = new Date(s.paid_at || s.created_at || Date.now());
    return (!from || d >= from) && (!to || d <= to);
  });
}

function renderSales() {
  applySalesFilter();
  const now = new Date();
  const dayAgo = (n) => new Date(now.getTime() - n * 24 * 3600 * 1000);
  const sum = (arr) => arr.reduce((s, x) => s + Number(x.total || 0), 0);
  const inRange = (days) => filteredSales.filter((s) => new Date(s.paid_at) >= dayAgo(days));
  const cash = filteredSales.filter((s) => s.payment_method === 'cash');
  const qr = filteredSales.filter((s) => s.payment_method === 'qr');

  qs('sale-today').textContent = money(sum(inRange(1)));
  qs('sale-week').textContent = money(sum(inRange(7)));
  qs('sale-month').textContent = money(sum(inRange(30)));
  qs('cash-total').textContent = money(sum(cash));
  qs('qr-total').textContent = money(sum(qr));
  qs('grand-total').textContent = money(sum(filteredSales));

  const history = qs('sales-history');
  history.innerHTML = '';
  if (!filteredSales.length) history.innerHTML = '<div class="empty">ยังไม่มีข้อมูลยอดขาย</div>';
  filteredSales.slice().reverse().forEach((s) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.textContent = `${new Date(s.paid_at).toLocaleString('th-TH')} · ${s.payment_method} · ${money(s.total)} บาท`;
    history.appendChild(row);
  });

  const hit = {};
  filteredSales.forEach((sale) => (sale.items || []).forEach((it) => { hit[it.name] = (hit[it.name] || 0) + 1; }));
  const hot = qs('hot-menu');
  hot.innerHTML = '';
  const sorted = Object.entries(hit).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!sorted.length) hot.innerHTML = '<div class="empty">ยังไม่มีข้อมูลยอดฮิต</div>';
  sorted.forEach(([name, qty]) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.textContent = `${name} · ${qty} รายการ`;
    hot.appendChild(row);
  });
}

function renderMenu() {
  const list = qs('menu-list');
  list.innerHTML = '';
  if (!db.menu.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีเมนู กด + เพิ่ม เพื่อเริ่มต้น</div>';
    return;
  }
  db.menu.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    const addons = Array.isArray(item.addons) && item.addons.length ? ` · add-on: ${item.addons.join(', ')}` : '';
    row.innerHTML = `<strong>${item.name}</strong> · ${money(item.price)} บาท${addons}<div class="manage-row"><button class="btn-soft" data-a="e">แก้ไข</button><button class="btn-soft" data-a="d">ลบ</button></div>`;
    row.querySelector('[data-a="e"]').addEventListener('click', () => {
      menuEditIndex = idx;
      qs('menu-name').value = item.name;
      qs('menu-price').value = item.price;
      qs('menu-addons').value = (item.addons || []).join(', ');
    });
    row.querySelector('[data-a="d"]').addEventListener('click', async () => {
      db.menu.splice(idx, 1);
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) });
      await loadData();
    });
    list.appendChild(row);
  });
}

function renderSystem() {
  const s = db.settings || {};
  qs('table-count').value = db.tableCount || 8;
  qs('service-mode').value = s.serviceMode || 'table';
  qs('store-name').value = s.storeName || 'FAKDU';
  qs('store-logo-name').value = s.logoName || '';
  qs('bank-name').value = s.bankName || '';
  qs('promptpay').value = s.promptPay || '';
  qs('admin-pin').value = s.adminPin || '2468';
  if (s.themeColor) qs('theme-color').value = s.themeColor;
  if (s.bgColor) qs('bg-color').value = s.bgColor;
}

async function loadData() {
  db = await api('/api/data');
  if (db.error) return;
  version = db.meta.version;
  renderTables();
  renderCashier();
  renderSales();
  renderMenu();
  renderSystem();
}

function bind() {
  document.querySelectorAll('[data-screen]').forEach((btn) => btn.addEventListener('click', () => showScreen(btn.dataset.screen)));
  document.querySelectorAll('[data-subtab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-subtab]').forEach((s) => s.classList.toggle('is-active', s === btn));
    qs('panel-sales').classList.toggle('hidden', btn.dataset.subtab !== 'sales');
    qs('panel-manage').classList.toggle('hidden', btn.dataset.subtab !== 'manage');
  }));

  qs('quick-down').addEventListener('click', async () => { qs('table-count').value = Math.max(1, Number(qs('table-count').value) - 1); await qs('update-table-count').click(); });
  qs('quick-mid').addEventListener('click', async () => { qs('table-count').value = db.tableCount || 8; await qs('update-table-count').click(); });
  qs('quick-up').addEventListener('click', async () => { qs('table-count').value = Number(qs('table-count').value || 0) + 1; await qs('update-table-count').click(); });

  qs('update-table-count').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount: Number(qs('table-count').value), settings: { serviceMode: qs('service-mode').value } }) });
    await loadData();
  });

  qs('open-add-menu').addEventListener('click', () => { menuEditIndex = -1; qs('menu-name').value = ''; qs('menu-price').value = ''; qs('menu-addons').value = ''; });
  qs('save-menu').addEventListener('click', async () => {
    const name = qs('menu-name').value.trim();
    const price = Number(qs('menu-price').value || 0);
    const addons = qs('menu-addons').value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!name || price <= 0) return;
    const payload = { name, price, addons };
    if (menuEditIndex >= 0) db.menu[menuEditIndex] = { ...db.menu[menuEditIndex], ...payload };
    else db.menu.push({ id: Date.now(), ...payload });
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) });
    menuEditIndex = -1;
    await loadData();
  });

  qs('apply-filter').addEventListener('click', renderSales);

  qs('save-system').addEventListener('click', async () => {
    let qrImage = db.settings?.qrImage || '';
    const file = qs('qr-image').files?.[0];
    if (file) qrImage = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: {
      storeName: qs('store-name').value.trim(), logoName: qs('store-logo-name').value.trim(),
      themeColor: qs('theme-color').value, bgColor: qs('bg-color').value,
      bankName: qs('bank-name').value.trim(), promptPay: qs('promptpay').value.trim(),
      adminPin: qs('admin-pin').value.trim() || '2468', qrImage,
    } }) });
    await loadData();
  });

  qs('reset-pin').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: { adminPin: '2468' } }) });
    await loadData();
  });

  qs('backup-db').addEventListener('click', async () => {
    const backup = await api('/api/backup');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fakdu-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  });

  qs('restore-db').addEventListener('click', async () => {
    const file = qs('restore-file').files?.[0];
    if (!file) return;
    const json = JSON.parse(await file.text());
    await api('/api/restore', { method: 'POST', body: JSON.stringify(json) });
    await loadData();
  });

  qs('logout-backstore').addEventListener('click', logoutAdmin);
  qs('logout-system').addEventListener('click', logoutAdmin);
}

async function poll() {
  const info = await api(`/api/staff/live?since=${version}`);
  if (info.changed) {
    const pendingNow = (await api('/api/data')).tables.some((t) => t.status === 'pending_order');
    if (pendingNow) qs('new-order-sound')?.play().catch(() => {});
    await loadData();
  }
}

(async function init() {
  bind();
  await loadData();
  setInterval(poll, 2500);
})();
