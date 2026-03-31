let db;
let version = 0;
let adminUnlocked = false;
let selectedTableId = null;
let orderCart = [];
let menuEditIndex = -1;
let activeCashierTableId = null;

const statusMap = {
  available: { label: 'ว่าง', tone: 'available', icon: '○' },
  pending_order: { label: 'ลูกค้ารอพนักงานยืนยัน', tone: 'pending', icon: '🔔' },
  accepted_order: { label: 'รับออร์เดอร์แล้ว', tone: 'accepted', icon: '✅' },
  checkout_requested: { label: 'รอเช็คบิล', tone: 'checkout', icon: '🧾' },
};

const qs = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitLabel = () => (db?.settings?.serviceMode === 'queue' ? 'คิว' : 'โต๊ะ');
const qrApiBase = 'https://api.qrserver.com/v1/create-qr-code/';

function customerScanUrl(tableId) { return `${window.location.origin}/table/${tableId}`; }
function buildQrImageUrl(text) { return `${qrApiBase}?size=320x320&margin=8&data=${encodeURIComponent(text)}`; }

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return res.ok ? data : { error: data.error || `request_failed_${res.status}` };
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  qs(id).classList.remove('hidden');
  document.querySelectorAll('[data-screen]').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === id));
}

function applyTheme() {
  const s = db.settings || {};
  qs('header-store-name').textContent = s.storeName || 'FAKDU';
  qs('store-logo').innerHTML = s.logoImage ? `<img src="${s.logoImage}" alt="logo" />` : (s.logoName || 'LOGO');
  qs('shop-logo-preview').src = s.logoImage || '';
}

function getTableOrders(tableId) {
  return db.orders.filter((o) => o.target === 'table' && o.target_id === tableId && o.status !== 'cancelled');
}

function getTableSummary(tableId) {
  const orders = getTableOrders(tableId);
  const items = orders.flatMap((o) => o.items || []);
  const total = items.reduce((s, i) => s + Number(i.price || 0), 0);
  return { items, total };
}

function renderTables() {
  const grid = qs('table-grid');
  grid.innerHTML = '';
  db.tables.forEach((table) => {
    const meta = statusMap[table.status] || statusMap.available;
    const { items, total } = getTableSummary(table.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `table-card ${meta.tone} ${selectedTableId === table.id ? 'is-selected' : ''} ${selectedTableId === table.id && orderCart.length ? 'is-ordering' : ''}`;
    card.innerHTML = `
      <div class="table-head-row"><strong>${unitLabel()} ${table.id}</strong><span class="status-chip ${meta.tone}">${meta.icon} ${meta.label}</span></div>
      <div>${items.length} รายการ • ${money(total)} บาท</div>
      <small>${items.slice(-2).map((i) => i.name).join(' • ') || 'ยังไม่มีรายการ'}</small>
    `;
    card.addEventListener('click', () => selectTable(table.id));
    grid.appendChild(card);
  });
}

function renderOrderMenuChoices() {
  const grid = qs('order-menu-grid');
  grid.innerHTML = '';
  db.menu.forEach((item) => {
    const btn = document.createElement('article');
    btn.className = 'menu-choice visual';
    btn.innerHTML = `<div class="menu-choice-thumb">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : '🍽️'}</div><strong>${item.name}</strong><small>฿${money(item.price)}</small>`;
    btn.addEventListener('click', () => {
      orderCart.push({ name: item.name, price: Number(item.price), addon: '', note: '', qty: 1 });
      renderOrderCart();
    });
    grid.appendChild(btn);
  });
}

function renderOrderCart() {
  const list = qs('order-cart-list');
  list.innerHTML = '';
  if (!orderCart.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการในตะกร้า</div>';
    qs('order-cart-total').textContent = 'รวม 0.00 บาท';
    renderTables();
    return;
  }
  orderCart.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `<strong>${item.name}</strong> · ${money(item.price)} บาท ${item.addon ? `• ${item.addon}` : ''} ${item.note ? `• ${item.note}` : ''} <button class="btn-soft">ลบ</button>`;
    row.querySelector('button').addEventListener('click', () => { orderCart.splice(idx, 1); renderOrderCart(); });
    list.appendChild(row);
  });
  qs('order-cart-total').textContent = `รวม ${money(orderCart.reduce((s, i) => s + Number(i.price || 0), 0))} บาท`;
  renderTables();
}

function renderExistingOrders(tableId) {
  const { items, total } = getTableSummary(tableId);
  const list = qs('order-existing-list');
  list.innerHTML = '';
  if (!items.length) list.innerHTML = '<div class="empty">ยังไม่มีรายการที่สั่งแล้ว</div>';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.textContent = `${item.name} • ${money(item.price)} บาท ${item.note || ''}`;
    list.appendChild(row);
  });
  qs('order-existing-total').textContent = `ยอดรวมตอนนี้ ${money(total)} บาท`;
}

function selectTable(tableId) {
  selectedTableId = tableId;
  orderCart = [];
  const table = db.tables.find((t) => t.id === tableId);
  const meta = statusMap[table?.status] || statusMap.available;
  qs('order-meta-table').textContent = `${unitLabel()} ${tableId}`;
  qs('order-meta-status').textContent = `สถานะ: ${meta.label}`;
  qs('accept-table-order').classList.toggle('hidden', table?.status !== 'pending_order');
  qs('order-panel-empty').classList.add('hidden');
  qs('order-panel-active').classList.remove('hidden');
  renderOrderMenuChoices();
  renderOrderCart();
  renderExistingOrders(tableId);
  renderTables();
}

async function submitOrderFromPanel() {
  if (!selectedTableId || !orderCart.length) return;
  const res = await api('/api/order', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: selectedTableId, cart: orderCart, source: 'staff' }) });
  if (res.error) return;
  orderCart = [];
  await loadData();
  selectTable(selectedTableId);
}

async function openBill(targetId) {
  const bill = await api(`/api/bill/table/${targetId}`);
  if (bill.error) return;
  activeCashierTableId = targetId;
  qs('bill-title').textContent = `${unitLabel()} ${targetId}`;
  qs('bill-items').innerHTML = '';
  bill.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.textContent = `${item.name} • ${money(item.price)} บาท`;
    qs('bill-items').appendChild(row);
  });
  qs('bill-total').textContent = money(bill.total);
  qs('cashier-empty').classList.add('hidden');
  qs('cashier-bill').classList.remove('hidden');
}

function renderCashier() {
  const wrap = qs('checkout-list');
  wrap.innerHTML = '';
  const queues = db.tables
    .filter((t) => ['pending_order', 'accepted_order', 'checkout_requested'].includes(t.status))
    .map((table) => {
      const orders = getTableOrders(table.id);
      const lastOrderAt = orders.reduce((latest, order) => {
        const t = Date.parse(order.updated_at || order.created_at || 0);
        return t > latest ? t : latest;
      }, 0);
      return { table, lastOrderAt };
    })
    .sort((a, b) => a.lastOrderAt - b.lastOrderAt);
  qs('checkout-count').textContent = `${queues.length} รายการ`;
  if (!queues.length) {
    wrap.innerHTML = '<div class="empty">ยังไม่มีคิวใช้งาน</div>';
    return;
  }
  queues.forEach((entry, idx) => {
    const table = entry.table;
    const row = document.createElement('button');
    row.className = 'list-card';
    row.textContent = `#${idx + 1} ${unitLabel()} ${table.id} • ${(statusMap[table.status] || statusMap.available).label}`;
    row.addEventListener('click', () => openBill(table.id));
    wrap.appendChild(row);
  });
}

function renderMenu() {
  const list = qs('menu-list');
  list.innerHTML = '';
  db.menu.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `<strong>${item.name}</strong> • ${money(item.price)} บาท <button data-a="e" class="btn-soft">แก้ไข</button> <button data-a="d" class="btn-soft">ลบ</button>`;
    row.querySelector('[data-a="e"]').addEventListener('click', () => { menuEditIndex = idx; qs('menu-name').value = item.name; qs('menu-price').value = item.price; qs('menu-addons').value = (item.addons || []).join(','); });
    row.querySelector('[data-a="d"]').addEventListener('click', async () => { db.menu.splice(idx, 1); await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) }); await loadData(); });
    list.appendChild(row);
  });
}

function renderSystem() {
  const s = db.settings || {};
  qs('table-count').value = db.tableCount || 8;
  qs('service-mode').value = s.serviceMode || 'table';
  qs('store-name').value = s.storeName || 'FAKDU';
  qs('bank-name').value = s.bankName || '';
  qs('promptpay').value = s.promptPay || '';
  qs('admin-pin').value = s.adminPin || 'admin';
  qs('dynamic-qr').checked = Boolean(s.dynamicPromptPay);
  renderTableQRList();
}

function openQRModal(title, url, imageUrl) {
  qs('qr-modal-title').textContent = title;
  qs('client-qr-image').src = imageUrl;
  qs('qr-download').href = imageUrl;
  qs('qr-download').download = `${title}.png`;
  qs('qr-print').onclick = () => window.open(url, '_blank');
  qs('qr-modal').classList.remove('hidden');
}

function renderTableQRList() {
  const wrap = qs('table-qr-list');
  wrap.innerHTML = '';
  db.tables.forEach((table) => {
    const btn = document.createElement('button');
    btn.className = 'btn-soft table-pick-btn';
    btn.textContent = `${unitLabel()} ${table.id}`;
    btn.addEventListener('click', () => {
      const url = customerScanUrl(table.id);
      openQRModal(`${unitLabel()}-${table.id}`, url, buildQrImageUrl(url));
    });
    wrap.appendChild(btn);
  });
}

function syncAdminUI() {
  qs('open-admin-login').classList.toggle('hidden', adminUnlocked);
  qs('admin-logout').classList.toggle('hidden', !adminUnlocked);
}

function requestAdminAccess(targetScreen) {
  if (adminUnlocked) return showScreen(targetScreen);
  qs('admin-login-modal').classList.remove('hidden');
  qs('admin-login-submit').dataset.targetScreen = targetScreen;
}

async function loadData() {
  db = await api('/api/data');
  if (db.error) return;
  version = db.meta.version;
  applyTheme();
  renderTables();
  renderCashier();
  renderMenu();
  renderSystem();
}

function bind() {
  document.querySelectorAll('[data-screen]').forEach((btn) => btn.addEventListener('click', () => {
    if (['backstore', 'system'].includes(btn.dataset.screen)) return requestAdminAccess(btn.dataset.screen);
    showScreen(btn.dataset.screen);
  }));
  document.querySelectorAll('[data-system-tab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-system-tab]').forEach((s) => s.classList.toggle('is-active', s === btn));
    ['profile', 'payment', 'backup', 'qr'].forEach((name) => qs(`system-${name}`).classList.toggle('hidden', name !== btn.dataset.systemTab));
  }));

  qs('open-client-qr').addEventListener('click', () => openQRModal('staff-mode', `${window.location.origin}/scan/staff`, buildQrImageUrl(`${window.location.origin}/scan/staff`)));
  qs('close-qr-modal').addEventListener('click', () => qs('qr-modal').classList.add('hidden'));

  qs('open-admin-login').addEventListener('click', () => qs('admin-login-modal').classList.remove('hidden'));
  qs('close-admin-login').addEventListener('click', () => {
    qs('admin-login-modal').classList.add('hidden');
    qs('admin-login-pin').value = '';
  });
  qs('admin-logout').addEventListener('click', () => { adminUnlocked = false; localStorage.removeItem('fakdu_admin_auth'); syncAdminUI(); showScreen('customer'); });
  qs('admin-login-submit').addEventListener('click', () => {
    const pin = qs('admin-login-pin').value.trim();
    if (pin && pin === (db.settings?.adminPin || 'admin')) {
      adminUnlocked = true;
      localStorage.setItem('fakdu_admin_auth', '1');
      qs('admin-login-modal').classList.add('hidden');
      qs('admin-login-pin').value = '';
      syncAdminUI();
      showScreen(qs('admin-login-submit').dataset.targetScreen || 'backstore');
    }
  });
  qs('admin-login-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') qs('admin-login-submit').click();
  });

  qs('accept-table-order').addEventListener('click', async () => {
    if (!selectedTableId) return;
    await api('/api/table/accept', { method: 'POST', body: JSON.stringify({ table_id: selectedTableId }) });
    await loadData();
    selectTable(selectedTableId);
  });

  qs('order-submit').addEventListener('click', submitOrderFromPanel);

  qs('bill-pay-cash').addEventListener('click', async () => { if (!activeCashierTableId) return; await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: activeCashierTableId, payment_method: 'cash' }) }); await loadData(); });
  qs('bill-pay-qr').addEventListener('click', async () => { if (!activeCashierTableId) return; await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: activeCashierTableId, payment_method: 'qr' }) }); await loadData(); });

  qs('update-table-count').addEventListener('click', async () => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount: Number(qs('table-count').value), settings: { serviceMode: qs('service-mode').value } }) }); await loadData(); });
  qs('save-menu').addEventListener('click', async () => {
    const name = qs('menu-name').value.trim();
    const price = Number(qs('menu-price').value || 0);
    if (!name || price <= 0) return;
    const payload = { name, price, addons: qs('menu-addons').value.split(',').map((x) => x.trim()).filter(Boolean), image: '' };
    if (menuEditIndex >= 0) db.menu[menuEditIndex] = { ...db.menu[menuEditIndex], ...payload };
    else db.menu.push({ id: Date.now(), ...payload });
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) });
    qs('menu-name').value = ''; qs('menu-price').value = ''; qs('menu-addons').value = ''; menuEditIndex = -1;
    await loadData();
  });

  qs('shop-logo-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
    qs('shop-logo-preview').src = dataUrl;
  });

  qs('save-system').addEventListener('click', async () => {
    let qrImage = db.settings?.qrImage || '';
    let logoImage = qs('shop-logo-preview').src || db.settings?.logoImage || '';
    const qrFile = qs('qr-image').files?.[0];
    if (qrFile) qrImage = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(qrFile); });
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: { storeName: qs('store-name').value.trim(), bankName: qs('bank-name').value.trim(), promptPay: qs('promptpay').value.trim(), adminPin: qs('admin-pin').value.trim() || 'admin', dynamicPromptPay: qs('dynamic-qr').checked, qrImage, logoImage } }) });
    await loadData();
  });

  qs('backup-db').addEventListener('click', async () => {
    const backup = await api('/api/backup');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  });
  qs('restore-db').addEventListener('click', async () => { const file = qs('restore-file').files?.[0]; if (!file) return; await api('/api/restore', { method: 'POST', body: JSON.stringify(JSON.parse(await file.text())) }); await loadData(); });

  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m) {
      m.classList.add('hidden');
      if (m.id === 'admin-login-modal') qs('admin-login-pin').value = '';
    }
  }));
}

async function poll() {
  const info = await api(`/api/staff/live?since=${version}`);
  if (info.changed) {
    if ((info.tables || []).some((t) => t.status === 'pending_order')) qs('new-order-sound')?.play().catch(() => {});
    await loadData();
    if (selectedTableId) selectTable(selectedTableId);
  }
}

(async function init() {
  adminUnlocked = localStorage.getItem('fakdu_admin_auth') === '1';
  syncAdminUI();
  bind();
  await loadData();
  setInterval(poll, 1200);
})();
