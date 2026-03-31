let db;
let version = 0;
let selectedTableId = null;
let orderCart = [];
let menuEditIndex = -1;
let activeCashierTableId = null;
let menuImagePreviewData = '';

const statusMap = {
  available: { label: 'ว่าง', tone: 'available', icon: '○' },
  pending_order: { label: 'ลูกค้ารอพนักงานยืนยัน', tone: 'pending', icon: '🔔' },
  accepted_order: { label: 'รับออร์เดอร์แล้ว', tone: 'accepted', icon: '✅' },
  checkout_requested: { label: 'รอเช็คบิล', tone: 'checkout', icon: '🧾' },
};

const qs = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitLabel = () => (db?.settings?.serviceMode === 'queue' ? 'คิว' : 'Table');
const qrApiBase = 'https://api.qrserver.com/v1/create-qr-code/';

function customerScanUrl(tableId) { return `${window.location.origin}/customer?table=${tableId}`; }
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
    card.className = `table-card ${meta.tone}`;
    card.innerHTML = items.length
      ? `<div class="table-head-row"><strong>${unitLabel()} ${table.id}</strong><span class="status-chip ${meta.tone}">${meta.icon}</span></div>
         <small>${items.slice(-4).map((i) => `${i.name} • ${money(i.price)}`).join('<br>')}</small>
         <div class="table-total">รวม ${money(total)} บาท</div>`
      : `<div class="table-head-row"><strong>${unitLabel()} ${table.id}</strong><span class="status-chip available">○</span></div>
         <small>พร้อมรับออเดอร์</small>`;
    card.addEventListener('click', () => selectTable(table.id));
    grid.appendChild(card);
  });
}

function renderOrderMenuChoices() {
  const grid = qs('order-menu-grid');
  grid.innerHTML = '';
  db.menu.forEach((item) => {
    const btn = document.createElement('article');
    btn.className = 'menu-choice visual large-thumb';
    btn.innerHTML = `<div class="menu-choice-thumb">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : 'Image'}</div><strong>${item.name}</strong><small>฿${money(item.price)}</small>`;
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
    return;
  }
  orderCart.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `<strong>${item.name}</strong> · ${money(item.price)} บาท <button class="btn-soft">ลบ</button>`;
    row.querySelector('button').addEventListener('click', () => { orderCart.splice(idx, 1); renderOrderCart(); });
    list.appendChild(row);
  });
  qs('order-cart-total').textContent = `รวม ${money(orderCart.reduce((s, i) => s + Number(i.price || 0), 0))} บาท`;
}

function renderExistingOrders(tableId) {
  const { items, total } = getTableSummary(tableId);
  const list = qs('order-existing-list');
  list.innerHTML = '';
  if (!items.length) list.innerHTML = '<div class="empty">ยังไม่มีรายการที่สั่งแล้ว</div>';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.textContent = `${item.name} • ${money(item.price)} บาท`;
    list.appendChild(row);
  });
  qs('order-existing-total').textContent = `ยอดรวมตอนนี้ ${money(total)} บาท`;
}

function renderDeskSummary() {
  const metaNode = qs('desk-selected-table');
  const statusNode = qs('desk-selected-status');
  const list = qs('desk-selected-items');
  const totalNode = qs('desk-selected-total');
  if (!metaNode || !statusNode || !list || !totalNode) return;

  if (!selectedTableId) {
    metaNode.textContent = 'ยังไม่ได้เลือกโต๊ะ';
    statusNode.textContent = 'เลือกโต๊ะเพื่อดูสรุปคำสั่งซื้อ';
    list.innerHTML = '<div class="empty">ยังไม่มีข้อมูล</div>';
    totalNode.textContent = 'รวม 0.00 บาท';
    return;
  }

  const table = db.tables.find((t) => t.id === selectedTableId);
  const meta = statusMap[table?.status] || statusMap.available;
  const { items, total } = getTableSummary(selectedTableId);
  metaNode.textContent = `${unitLabel()} ${selectedTableId}`;
  statusNode.textContent = `สถานะ: ${meta.label}`;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการอาหาร</div>';
  } else {
    items.slice().reverse().forEach((item) => {
      const row = document.createElement('div');
      row.className = 'list-card';
      row.textContent = `${item.name} • ${money(item.price)} บาท`;
      list.appendChild(row);
    });
  }
  totalNode.textContent = `รวม ${money(total)} บาท`;
}

function selectTable(tableId) {
  selectedTableId = tableId;
  orderCart = [];
  const table = db.tables.find((t) => t.id === tableId);
  const meta = statusMap[table?.status] || statusMap.available;
  qs('order-meta-table').textContent = `${unitLabel()} ${tableId}`;
  qs('order-meta-status').textContent = `สถานะ: ${meta.label}`;
  renderOrderMenuChoices();
  renderOrderCart();
  renderExistingOrders(tableId);
  renderDeskSummary();
  qs('table-order-modal').classList.remove('hidden');
}

async function submitOrderFromPanel() {
  if (!selectedTableId || !orderCart.length) return;
  const res = await api('/api/order', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: selectedTableId, cart: orderCart, source: 'staff' }) });
  if (res.error) return;
  qs('table-order-modal').classList.add('hidden');
  orderCart = [];
  await loadData();
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
  qs('payment-modal').classList.remove('hidden');
}

function renderCashier() {
  const wrap = qs('checkout-list');
  wrap.innerHTML = '';
  const queues = db.tables.filter((t) => ['pending_order', 'accepted_order', 'checkout_requested'].includes(t.status));
  qs('checkout-count').textContent = `${queues.length} รายการ`;
  if (!queues.length) {
    wrap.innerHTML = '<div class="empty">ยังไม่มีคิวใช้งาน</div>';
    return;
  }
  queues.forEach((table) => {
    const meta = statusMap[table.status] || statusMap.available;
    const row = document.createElement('button');
    row.className = `list-card checkout-card ${meta.tone}`;
    row.innerHTML = `<strong>${meta.icon} ${unitLabel()} ${table.id}</strong><small>${meta.label}</small>`;
    row.addEventListener('click', () => openBill(table.id));
    wrap.appendChild(row);
  });
}

function renderMenu() {
  const list = qs('menu-list');
  list.innerHTML = '';
  db.menu.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-card menu-admin-row';
    row.innerHTML = `<div class="menu-admin-meta"><div class="menu-thumb">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : 'IMG'}</div><div><strong>${item.name}</strong><small>${money(item.price)} บาท</small></div></div><div><button data-a="e" class="btn-soft">แก้ไข</button> <button data-a="d" class="btn-soft">ลบ</button></div>`;
    row.querySelector('[data-a="e"]').addEventListener('click', () => {
      menuEditIndex = idx;
      qs('menu-name').value = item.name;
      qs('menu-price').value = item.price;
      qs('menu-addons').value = (item.addons || []).join(',');
      menuImagePreviewData = item.image || '';
      qs('menu-image-preview').src = menuImagePreviewData;
    });
    row.querySelector('[data-a="d"]').addEventListener('click', async () => { db.menu.splice(idx, 1); await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) }); await loadData(); });
    list.appendChild(row);
  });
}

function renderSales() {
  const sales = db.sales || [];
  const total = sales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const cash = sales.filter((s) => s.payment_method === 'cash').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const qr = sales.filter((s) => s.payment_method === 'qr').reduce((sum, s) => sum + Number(s.total || 0), 0);
  qs('sales-summary').innerHTML = `
    <div class="list-card"><strong>ยอดขายรวม</strong><div>${money(total)} บาท</div></div>
    <div class="list-card"><strong>เงินสด</strong><div>${money(cash)} บาท</div></div>
    <div class="list-card"><strong>โอน/QR</strong><div>${money(qr)} บาท</div></div>`;
  qs('sales-list').innerHTML = '';
  sales.slice().reverse().forEach((sale) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.textContent = `${unitLabel()} ${sale.target_id} • ${money(sale.total)} บาท • ${sale.payment_method}`;
    qs('sales-list').appendChild(row);
  });
}

function renderSystem() {
  const s = db.settings || {};
  qs('table-count').value = db.tableCount || 8;
  qs('service-mode').value = s.serviceMode || 'table';
  qs('store-name').value = s.storeName || 'FAKDU';
  qs('bank-name').value = s.bankName || '';
  qs('promptpay').value = s.promptPay || '';
  qs('dynamic-qr').checked = Boolean(s.dynamicPromptPay);
  renderTableQRList();
}

function openQRModal(title, url, imageUrl) {
  qs('qr-modal-title').textContent = title;
  qs('client-qr-image').src = imageUrl;
  qs('qr-download').href = imageUrl;
  qs('qr-download').download = `${title}.png`;
  qs('qr-print').onclick = () => window.open(imageUrl, '_blank');
  qs('qr-modal').classList.remove('hidden');
}

function renderTableQRList() {
  const wrap = qs('table-qr-list');
  wrap.innerHTML = '';
  db.tables.forEach((table) => {
    const btn = document.createElement('button');
    btn.className = 'btn-soft table-pick-btn';
    btn.textContent = `Table ${table.id}`;
    btn.addEventListener('click', () => {
      const url = customerScanUrl(table.id);
      openQRModal(`Table-${table.id}`, url, buildQrImageUrl(url));
    });
    wrap.appendChild(btn);
  });
}

async function loadData() {
  db = await api('/api/data');
  if (db.error) return;
  version = db.meta.version;
  applyTheme();
  renderTables();
  renderCashier();
  renderMenu();
  renderSales();
  renderSystem();
  renderDeskSummary();
}

function bind() {
  document.querySelectorAll('[data-screen]').forEach((btn) => btn.addEventListener('click', () => showScreen(btn.dataset.screen)));
  document.querySelectorAll('[data-system-tab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-system-tab]').forEach((s) => s.classList.toggle('is-active', s === btn));
    ['general', 'payment', 'qr'].forEach((name) => qs(`system-${name}`).classList.toggle('hidden', name !== btn.dataset.systemTab));
  }));
  document.querySelectorAll('[data-backstore-tab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-backstore-tab]').forEach((s) => s.classList.toggle('is-active', s === btn));
    ['menu', 'sales'].forEach((name) => qs(`backstore-${name}`).classList.toggle('hidden', name !== btn.dataset.backstoreTab));
  }));

  qs('open-client-qr').addEventListener('click', () => openQRModal('staff-mode', `${window.location.origin}/staff`, buildQrImageUrl(`${window.location.origin}/staff`)));
  qs('close-qr-modal').addEventListener('click', () => qs('qr-modal').classList.add('hidden'));
  qs('close-table-order-modal').addEventListener('click', () => qs('table-order-modal').classList.add('hidden'));
  qs('close-payment-modal').addEventListener('click', () => qs('payment-modal').classList.add('hidden'));

  qs('order-submit').addEventListener('click', submitOrderFromPanel);

  qs('bill-pay-cash').addEventListener('click', async () => {
    if (!activeCashierTableId) return;
    await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: activeCashierTableId, payment_method: 'cash' }) });
    qs('payment-modal').classList.add('hidden');
    await loadData();
  });
  qs('bill-pay-qr').addEventListener('click', async () => {
    if (!activeCashierTableId) return;
    await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: activeCashierTableId, payment_method: 'qr' }) });
    qs('payment-modal').classList.add('hidden');
    await loadData();
  });

  qs('update-table-count').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount: Number(qs('table-count').value), settings: { serviceMode: qs('service-mode').value } }) });
    await loadData();
  });

  qs('menu-image-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    menuImagePreviewData = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
    qs('menu-image-preview').src = menuImagePreviewData;
  });

  qs('save-menu').addEventListener('click', async () => {
    const name = qs('menu-name').value.trim();
    const price = Number(qs('menu-price').value || 0);
    if (!name || price <= 0) return;
    const payload = { name, price, addons: qs('menu-addons').value.split(',').map((x) => x.trim()).filter(Boolean), image: menuImagePreviewData || '' };
    if (menuEditIndex >= 0) db.menu[menuEditIndex] = { ...db.menu[menuEditIndex], ...payload };
    else db.menu.push({ id: Date.now(), ...payload });
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) });
    qs('menu-name').value = '';
    qs('menu-price').value = '';
    qs('menu-addons').value = '';
    qs('menu-image-file').value = '';
    qs('menu-image-preview').src = '';
    menuImagePreviewData = '';
    menuEditIndex = -1;
    await loadData();
  });

  qs('shop-logo-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
    qs('shop-logo-preview').src = dataUrl;
  });


  qs('desk-open-order-modal')?.addEventListener('click', () => { if (selectedTableId) selectTable(selectedTableId); });
  qs('desk-open-bill-modal')?.addEventListener('click', () => { if (selectedTableId) openBill(selectedTableId); });
  qs('desk-open-table-qr')?.addEventListener('click', () => {
    if (!selectedTableId) return;
    const url = customerScanUrl(selectedTableId);
    openQRModal(`Table-${selectedTableId}`, url, buildQrImageUrl(url));
  });

  qs('save-system').addEventListener('click', async () => {
    let qrImage = db.settings?.qrImage || '';
    const logoImage = qs('shop-logo-preview').src || db.settings?.logoImage || '';
    const qrFile = qs('qr-image').files?.[0];
    if (qrFile) qrImage = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(qrFile); });
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: { storeName: qs('store-name').value.trim(), bankName: qs('bank-name').value.trim(), promptPay: qs('promptpay').value.trim(), dynamicPromptPay: qs('dynamic-qr').checked, qrImage, logoImage } }),
    });
    await loadData();
  });

  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  }));
}

async function poll() {
  const info = await api(`/api/staff/live?since=${version}`);
  if (info.changed) {
    if ((info.tables || []).some((t) => t.status === 'pending_order')) qs('new-order-sound')?.play().catch(() => {});
    await loadData();
  }
}

(async function init() {
  bind();
  await loadData();
  setInterval(poll, 1200);
})();
