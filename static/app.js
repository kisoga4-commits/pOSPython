let db;
let version = 0;
let menuEditIndex = -1;
let filteredSales = [];
let activeBill = null;
let adminUnlocked = false;
let selectedTableId = null;
let selectedMenuItem = null;
let orderCart = [];
let tableGridColumns = 4;

const statusMap = {
  available: { label: 'ว่าง', tone: 'available', note: 'พร้อมรับลูกค้า' },
  pending_order: { label: 'มีออร์เดอร์ใหม่', tone: 'pending', note: 'รอพนักงานรับออร์เดอร์' },
  accepted_order: { label: 'กำลังทำ', tone: 'accepted', note: 'กำลังเตรียมอาหาร' },
  checkout_requested: { label: 'รอเช็คบิล', tone: 'checkout', note: 'ลูกค้าขอชำระเงิน' },
};

const qs = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitLabel = () => (db?.settings?.serviceMode === 'queue' ? 'คิว' : 'โต๊ะ');
const qrApiBase = 'https://api.qrserver.com/v1/create-qr-code/';

function customerScanUrl(tableId) {
  return `${window.location.origin}/scan/customer/${tableId}`;
}

function buildQrImageUrl(text) {
  return `${qrApiBase}?size=300x300&margin=8&data=${encodeURIComponent(text)}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { error: 'invalid_json', raw: text };
  }
  if (!res.ok) {
    return { error: data.error || `request_failed_${res.status}`, status: res.status, ...data };
  }
  return data;
}

function applyTheme() {
  const s = db.settings || {};
  document.documentElement.style.setProperty('--wine', s.themeColor || '#8f1d2a');
  document.documentElement.style.setProperty('--bg', s.bgColor || '#f6efe9');
  qs('header-store-name').textContent = s.storeName || 'FAKDU';
  const logoSlot = qs('store-logo');
  logoSlot.textContent = s.logoName || 'LOGO';
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  qs(id).classList.remove('hidden');
  document.querySelectorAll('[data-screen]').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === id));
}

function getTableOrders(tableId) {
  return db.orders.filter((o) => o.target === 'table' && o.target_id === tableId && o.status !== 'cancelled');
}

function getTableSummary(tableId) {
  const orders = getTableOrders(tableId);
  const items = orders.flatMap((o) => o.items || []);
  const total = items.reduce((s, i) => s + Number(i.price || 0), 0);
  const latestOrder = orders.slice().sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))[0];
  return { orders, items, total, latestOrder };
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('th-TH', { hour12: false });
}

function renderTables() {
  const grid = qs('table-grid');
  grid.style.gridTemplateColumns = `repeat(${tableGridColumns}, minmax(0, 1fr))`;
  grid.innerHTML = '';
  const unit = unitLabel();
  db.tables.forEach((table) => {
    const meta = statusMap[table.status] || statusMap.available;
    const { items, total, latestOrder } = getTableSummary(table.id);
    const topItems = items.slice(-3).map((item) => `${item.name} x${item.qty || 1}`).join(' · ');

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `table-card ${meta.tone} ${table.status}`;
    card.innerHTML = `
      <div class="table-head-row">
        <p class="table-no">${unit} ${table.id}</p>
        <span class="status-chip ${meta.tone}">${meta.label}</span>
      </div>
      <p class="table-note">${meta.note}</p>
      <div class="table-meta">${items.length} รายการ · ${money(total)} บาท</div>
      <div class="table-items-preview">${topItems || 'ยังไม่มีรายการสั่ง'}</div>
      <div class="table-time">อัปเดตล่าสุด ${formatDateTime(latestOrder?.updated_at || latestOrder?.created_at)}</div>
      ${table.status === 'pending_order' ? '<div class="alert-dot">ออร์เดอร์ใหม่เข้าระบบ</div>' : ''}
    `;
    card.addEventListener('click', () => openOrderModal(table.id));
    grid.appendChild(card);
  });
}

function waitingMinutes(openedAt) {
  if (!openedAt) return '-';
  const ms = Date.now() - new Date(openedAt).getTime();
  return `${Math.max(1, Math.round(ms / 60000))} นาที`;
}

function buildPromptPayPayload(promptPayId, amount) {
  const sanitize = (v) => String(v || '').replace(/[^0-9A-Za-z]/g, '');
  const pp = sanitize(promptPayId);
  if (!pp) return '';
  const amountValue = Number(amount || 0).toFixed(2);
  return `PP|${pp}|${amountValue}`;
}

async function openBill(target, targetId) {
  activeBill = await api(`/api/bill/${target}/${targetId}`);
  if (activeBill.error) return;
  qs('bill-title').textContent = `${unitLabel()} ${targetId}`;

  const list = qs('bill-items');
  list.innerHTML = '';
  (activeBill.items || []).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `
      <strong>${item.name}</strong>
      <div>${money(item.price)} บาท ${item.addon ? `· add-on: ${item.addon}` : ''}</div>
      <div class="btn-row">
        <button class="btn-soft" data-action="edit">แก้ราคา</button>
        <button class="btn-soft danger" data-action="delete">ลบ</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const price = window.prompt('ราคาใหม่', item.price);
      if (price === null) return;
      await api('/api/order/item', {
        method: 'PATCH',
        body: JSON.stringify({ order_id: item.order_id, item_index: item.item_index, price: Number(price || 0) }),
      });
      await loadData();
      await openBill(target, targetId);
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      await api('/api/order/item', {
        method: 'DELETE',
        body: JSON.stringify({ order_id: item.order_id, item_index: item.item_index }),
      });
      await loadData();
      await openBill(target, targetId);
    });
    list.appendChild(row);
  });

  qs('bill-total').textContent = money(activeBill.total);
  const qrPreview = qs('bill-qr-preview');
  const useDynamic = Boolean(db.settings?.dynamicPromptPay);
  if (useDynamic) {
    qrPreview.classList.remove('hidden');
    qrPreview.innerHTML = `<div class="list-card"><strong>Dynamic PromptPay</strong><div>${buildPromptPayPayload(db.settings?.promptPay, activeBill.total)}</div></div>`;
  } else if (db.settings?.qrImage) {
    qrPreview.classList.remove('hidden');
    qrPreview.innerHTML = `<div class="list-card"><strong>Static QR (offline-ready)</strong><img src="${db.settings.qrImage}" class="qr-preview" alt="Static QR" /></div>`;
  } else {
    qrPreview.classList.add('hidden');
    qrPreview.innerHTML = '';
  }

  qs('bill-modal').classList.remove('hidden');
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
    const tableOrders = db.orders.filter((o) => o.target_id === table.id && o.status !== 'cancelled');
    const items = tableOrders.flatMap((o) => o.items || []);
    const total = items.reduce((s, i) => s + Number(i.price || 0), 0);
    const firstOrder = tableOrders[0];
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `
      <strong>${unitLabel()} ${table.id}</strong>
      <div>สถานะ: ${(statusMap[table.status] || statusMap.available).label}</div>
      <div>ยอดรวม ${money(total)} บาท · รอ ${waitingMinutes(firstOrder?.created_at)}</div>
      <div class="manage-row two-col">
        <button class="btn-soft" data-a="detail">เปิดบิล</button>
        <button class="btn-soft" data-a="accept">รับออเดอร์</button>
        <button class="btn-soft" data-m="cash">ปิดบิลเงินสด</button>
        <button class="btn-soft" data-m="qr">ปิดบิล QR</button>
      </div>
    `;

    row.querySelector('[data-a="detail"]').addEventListener('click', () => openBill('table', table.id));
    row.querySelector('[data-a="accept"]').addEventListener('click', async () => {
      await api('/api/table/accept', { method: 'POST', body: JSON.stringify({ table_id: table.id }) });
      await loadData();
    });
    row.querySelectorAll('button[data-m]').forEach((btn) => btn.addEventListener('click', async () => {
      await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: table.id, payment_method: btn.dataset.m }) });
      qs('bill-modal').classList.add('hidden');
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

function createInsights() {
  const now = new Date();
  const start7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const prev7 = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const sum = (arr) => arr.reduce((s, x) => s + Number(x.total || 0), 0);
  const current = filteredSales.filter((s) => new Date(s.paid_at) >= start7);
  const previous = filteredSales.filter((s) => {
    const d = new Date(s.paid_at);
    return d >= prev7 && d < start7;
  });
  const diff = sum(current) - sum(previous);

  const itemCount = {};
  filteredSales.forEach((sale) => (sale.items || []).forEach((it) => { itemCount[it.name] = (itemCount[it.name] || 0) + 1; }));
  const topItems = Object.entries(itemCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return { currentTotal: sum(current), previousTotal: sum(previous), diff, topItems };
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

  const insight = createInsights();
  qs('insight-summary').textContent = `7 วันล่าสุด ${money(insight.currentTotal)} บาท เทียบช่วงก่อนหน้า ${insight.diff >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${money(Math.abs(insight.diff))} บาท`;
  qs('insight-body').innerHTML = `
    <div class="list-card">ช่วงล่าสุด: ${money(insight.currentTotal)} บาท</div>
    <div class="list-card">ช่วงก่อนหน้า: ${money(insight.previousTotal)} บาท</div>
    <div class="list-card">ส่วนต่าง: ${insight.diff >= 0 ? '+' : '-'}${money(Math.abs(insight.diff))} บาท</div>
    <div class="list-card">Top items: ${insight.topItems.map(([name, qty]) => `${name} (${qty})`).join(', ') || '-'}</div>
  `;
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
    row.innerHTML = `<strong>${item.name}</strong> · ${money(item.price)} บาท${addons}<div>${item.image ? 'มีรูป' : 'ไม่มีรูป'}</div><div class="manage-row two-col"><button class="btn-soft" data-a="e">แก้ไข</button><button class="btn-soft" data-a="d">ลบ</button></div>`;
    row.querySelector('[data-a="e"]').addEventListener('click', () => {
      menuEditIndex = idx;
      qs('menu-name').value = item.name;
      qs('menu-price').value = item.price;
      qs('menu-image').value = item.image || '';
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
  qs('store-name').value = s.storeName || s.shopName || 'FAKDU';
  qs('store-logo-name').value = s.logoName || '';
  qs('bank-name').value = s.bankName || '';
  qs('promptpay').value = s.promptPay || '';
  qs('admin-pin').value = s.adminPin || 'admin';
  qs('dynamic-qr').checked = Boolean(s.dynamicPromptPay);
  if (s.themeColor) qs('theme-color').value = s.themeColor;
  if (s.bgColor) qs('bg-color').value = s.bgColor;
  renderTableQRCodes();
}

function openModal(id) {
  qs(id).classList.remove('hidden');
}

function closeModal(id) {
  qs(id).classList.add('hidden');
}

function syncAdminUI() {
  qs('open-admin-login').classList.toggle('hidden', adminUnlocked);
  qs('admin-logout').classList.toggle('hidden', !adminUnlocked);
}

function requestAdminAccess(targetScreen) {
  if (adminUnlocked) {
    showScreen(targetScreen);
    return;
  }
  openModal('admin-login-modal');
  qs('admin-login-submit').dataset.targetScreen = targetScreen;
}

function renderTableQRCodes() {
  const wrap = qs('table-qr-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  (db.tables || []).forEach((table) => {
    const tableUrl = customerScanUrl(table.id);
    const qrImageUrl = buildQrImageUrl(tableUrl);
    const card = document.createElement('div');
    card.className = 'qr-table-card';
    card.innerHTML = `
      <strong>${unitLabel()} ${table.id}</strong>
      <img src="${qrImageUrl}" alt="QR ${unitLabel()} ${table.id}" loading="lazy" />
      <a class="btn-soft" href="${tableUrl}" target="_blank" rel="noopener">เปิดลิงก์ลูกค้า</a>
      <a class="btn-soft" href="${qrImageUrl}" download="qr-${unitLabel()}-${table.id}.png">ดาวน์โหลด QR</a>
    `;
    wrap.appendChild(card);
  });
}

function selectMenuItem(item) {
  selectedMenuItem = item;
  qs('order-selected-menu').value = `${item.name} · ${money(item.price)}฿`;
  const addon = qs('order-addon');
  addon.innerHTML = '<option value="">+ add-on</option>';
  (item.addons || []).forEach((add) => {
    const option = document.createElement('option');
    option.value = add;
    option.textContent = add;
    addon.appendChild(option);
  });

  document.querySelectorAll('#order-menu-grid .menu-choice').forEach((btn) => {
    btn.classList.toggle('is-active', Number(btn.dataset.menuId) === Number(item.id));
  });
}

function renderOrderMenuChoices() {
  const grid = qs('order-menu-grid');
  grid.innerHTML = '';
  db.menu.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-choice';
    btn.dataset.menuId = item.id;
    btn.innerHTML = `<strong>${item.name}</strong><small>฿${money(item.price)}</small>`;
    btn.addEventListener('click', () => selectMenuItem(item));
    grid.appendChild(btn);
  });
}

function renderOrderCart() {
  const list = qs('order-cart-list');
  list.innerHTML = '';
  if (!orderCart.length) {
    list.innerHTML = '<div class="empty order-empty">🧺 ยังไม่มีรายการในตะกร้า</div>';
    qs('order-cart-total').textContent = 'Subtotal ฿0.00';
    return;
  }

  orderCart.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'order-line-item';
    const lineTotal = Number(item.price) * Number(item.qty);
    row.innerHTML = `
      <div class="order-line-main">
        <div>
          <div class="order-line-name">${item.name}</div>
          <div class="order-line-meta">${item.addon ? `+ ${item.addon}` : 'ไม่เพิ่ม add-on'} ${item.note ? `• ${item.note}` : ''}</div>
        </div>
        <div class="order-line-price">฿${money(lineTotal)}</div>
      </div>
      <div class="order-line-actions">
        <button class="order-mini-btn" data-act="minus">−</button>
        <span class="order-line-meta">${item.qty} จาน</span>
        <button class="order-mini-btn" data-act="plus">＋</button>
        <button class="order-mini-btn danger" data-act="remove">ลบ</button>
      </div>
    `;

    row.querySelector('[data-act="minus"]').addEventListener('click', () => {
      item.qty = Math.max(1, Number(item.qty) - 1);
      renderOrderCart();
    });
    row.querySelector('[data-act="plus"]').addEventListener('click', () => {
      item.qty = Number(item.qty) + 1;
      renderOrderCart();
    });
    row.querySelector('[data-act="remove"]').addEventListener('click', () => {
      orderCart.splice(idx, 1);
      renderOrderCart();
    });
    list.appendChild(row);
  });

  const total = orderCart.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty)), 0);
  qs('order-cart-total').textContent = `Subtotal ฿${money(total)}`;
}

function renderExistingOrders(tableId) {
  const list = qs('order-existing-list');
  const { items, total, latestOrder } = getTableSummary(tableId);
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty order-empty">🍽️ ยังไม่มีรายการที่สั่งแล้ว</div>';
  } else {
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'order-line-item';
      row.innerHTML = `
        <div class="order-line-main">
          <div class="order-line-name">${item.name}</div>
          <div class="order-line-price">฿${money((item.qty || 1) * Number(item.price || 0))}</div>
        </div>
        <div class="order-line-meta">${item.qty || 1} จาน ${item.addon ? `• + ${item.addon}` : ''} ${item.note ? `• ${item.note}` : ''}</div>
      `;
      list.appendChild(row);
    });
  }

  const latest = latestOrder?.updated_at || latestOrder?.created_at;
  qs('order-existing-total').textContent = `ยอดรวมตอนนี้ ฿${money(total)}`;
  qs('order-latest-time').textContent = `🕒 ล่าสุด ${latest ? formatDateTime(latest) : '-'} `;
}

function openOrderModal(tableId) {
  selectedTableId = tableId;
  selectedMenuItem = null;
  orderCart = [];
  const table = db.tables.find((t) => t.id === tableId);
  const meta = statusMap[table?.status] || statusMap.available;
  qs('order-modal-title').textContent = `${unitLabel()} ${tableId}`;
  qs('order-meta-table').textContent = `🪑 ${unitLabel()} ${tableId}`;
  qs('order-meta-status').textContent = `🔖 ${meta.label}`;
  qs('order-selected-menu').value = '';
  qs('order-addon').innerHTML = '<option value="">+ add-on</option>';
  qs('order-qty').value = 1;
  qs('order-note').value = '';
  renderOrderMenuChoices();
  renderOrderCart();
  renderExistingOrders(tableId);
  openModal('order-modal');
}

async function submitOrderFromModal() {
  if (!selectedTableId || !orderCart.length) return;
  const payloadItems = [];
  orderCart.forEach((item) => {
    const qty = Number(item.qty || 1);
    for (let i = 0; i < qty; i += 1) {
      payloadItems.push({ name: item.name, price: Number(item.price), addon: item.addon, note: item.note, qty: 1 });
    }
  });

  const res = await api('/api/order', {
    method: 'POST',
    body: JSON.stringify({
      target: 'table',
      target_id: selectedTableId,
      cart: payloadItems,
      source: 'staff',
      note: `staff-inline-${new Date().toISOString()}`,
    }),
  });
  if (res.error) return;

  orderCart = [];
  await loadData();
  renderOrderCart();
  renderExistingOrders(selectedTableId);
}

async function loadData() {
  db = await api('/api/data');
  if (db.error) {
    console.error('Failed to load data', db);
    return;
  }
  version = db.meta.version;
  applyTheme();
  renderTables();
  renderCashier();
  renderSales();
  renderMenu();
  renderSystem();

  if (selectedTableId && !qs('order-modal').classList.contains('hidden')) {
    renderExistingOrders(selectedTableId);
  }
}

function bind() {
  document.querySelectorAll('[data-screen]').forEach((btn) => btn.addEventListener('click', () => {
    if (['backstore', 'system'].includes(btn.dataset.screen)) {
      requestAdminAccess(btn.dataset.screen);
      return;
    }
    showScreen(btn.dataset.screen);
  }));
  document.querySelectorAll('[data-subtab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-subtab]').forEach((s) => s.classList.toggle('is-active', s === btn));
    qs('panel-sales').classList.toggle('hidden', btn.dataset.subtab !== 'sales');
    qs('panel-manage').classList.toggle('hidden', btn.dataset.subtab !== 'manage');
  }));

  qs('header-action').addEventListener('click', () => showScreen('customer'));
  qs('open-client-qr').addEventListener('click', () => {
    qs('client-qr-image').src = buildQrImageUrl(`${window.location.origin}/scan/staff`);
    openModal('qr-modal');
  });
  qs('close-qr-modal').addEventListener('click', () => closeModal('qr-modal'));
  qs('open-admin-login').addEventListener('click', () => openModal('admin-login-modal'));
  qs('close-admin-login').addEventListener('click', () => closeModal('admin-login-modal'));
  qs('admin-logout').addEventListener('click', () => {
    adminUnlocked = false;
    window.localStorage.removeItem('fakdu_admin_auth');
    syncAdminUI();
    showScreen('customer');
  });
  qs('admin-login-submit').addEventListener('click', () => {
    const pin = qs('admin-login-pin').value.trim();
    if (pin && pin === (db.settings?.adminPin || 'admin')) {
      adminUnlocked = true;
      window.localStorage.setItem('fakdu_admin_auth', '1');
      qs('admin-login-pin').value = '';
      closeModal('admin-login-modal');
      syncAdminUI();
      const target = qs('admin-login-submit').dataset.targetScreen || 'backstore';
      showScreen(target);
    }
  });

  qs('quick-down').addEventListener('click', () => {
    tableGridColumns = Math.max(2, tableGridColumns - 1);
    renderTables();
  });
  qs('quick-mid').addEventListener('click', () => {
    tableGridColumns = 4;
    renderTables();
  });
  qs('quick-up').addEventListener('click', () => {
    tableGridColumns = Math.min(6, tableGridColumns + 1);
    renderTables();
  });

  qs('order-qty-minus').addEventListener('click', () => {
    const input = qs('order-qty');
    input.value = Math.max(1, Number(input.value || 1) - 1);
  });
  qs('order-qty-plus').addEventListener('click', () => {
    const input = qs('order-qty');
    input.value = Number(input.value || 1) + 1;
  });

  qs('order-add-item').addEventListener('click', () => {
    if (!selectedMenuItem) return;
    const qty = Math.max(1, Number(qs('order-qty').value || 1));
    const addon = qs('order-addon').value;
    const note = qs('order-note').value.trim();
    orderCart.push({ name: selectedMenuItem.name, price: Number(selectedMenuItem.price), qty, addon, note });
    qs('order-note').value = '';
    qs('order-qty').value = 1;
    renderOrderCart();
  });

  qs('order-submit').addEventListener('click', submitOrderFromModal);
  qs('order-close').addEventListener('click', () => closeModal('order-modal'));
  qs('order-back').addEventListener('click', () => closeModal('order-modal'));

  qs('update-table-count').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount: Number(qs('table-count').value), settings: { serviceMode: qs('service-mode').value } }) });
    await loadData();
  });

  qs('open-add-menu').addEventListener('click', () => {
    menuEditIndex = -1;
    qs('menu-name').value = '';
    qs('menu-price').value = '';
    qs('menu-image').value = '';
    qs('menu-addons').value = '';
  });

  qs('save-menu').addEventListener('click', async () => {
    const name = qs('menu-name').value.trim();
    const price = Number(qs('menu-price').value || 0);
    const image = qs('menu-image').value.trim();
    const addons = qs('menu-addons').value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!name || price <= 0) return;
    const payload = { name, price, image, addons };
    if (menuEditIndex >= 0) db.menu[menuEditIndex] = { ...db.menu[menuEditIndex], ...payload };
    else db.menu.push({ id: Date.now(), ...payload });

    await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) });
    menuEditIndex = -1;
    qs('menu-name').value = '';
    qs('menu-price').value = '';
    qs('menu-image').value = '';
    qs('menu-addons').value = '';
    await loadData();
  });

  qs('apply-filter').addEventListener('click', renderSales);
  qs('open-insight').addEventListener('click', () => qs('insight-modal').classList.remove('hidden'));
  qs('close-insight').addEventListener('click', () => qs('insight-modal').classList.add('hidden'));
  qs('close-bill').addEventListener('click', () => qs('bill-modal').classList.add('hidden'));
  document.querySelectorAll('.modal').forEach((modalEl) => modalEl.addEventListener('click', (event) => {
    if (event.target === modalEl) modalEl.classList.add('hidden');
  }));

  qs('save-system').addEventListener('click', async () => {
    let qrImage = db.settings?.qrImage || '';
    const file = qs('qr-image').files?.[0];
    if (file) {
      qrImage = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }

    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: {
        storeName: qs('store-name').value.trim(),
        logoName: qs('store-logo-name').value.trim(),
        themeColor: qs('theme-color').value,
        bgColor: qs('bg-color').value,
        bankName: qs('bank-name').value.trim(),
        promptPay: qs('promptpay').value.trim(),
        adminPin: qs('admin-pin').value.trim() || 'admin',
        dynamicPromptPay: qs('dynamic-qr').checked,
        qrImage,
      } }),
    });
    await loadData();
  });

  qs('backup-db').addEventListener('click', async () => {
    const backup = await api('/api/backup');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fakdu-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  qs('restore-db').addEventListener('click', async () => {
    const file = qs('restore-file').files?.[0];
    if (!file) return;
    const json = JSON.parse(await file.text());
    await api('/api/restore', { method: 'POST', body: JSON.stringify(json) });
    await loadData();
  });
}

async function poll() {
  const info = await api(`/api/staff/live?since=${version}`);
  if (info.changed) {
    if ((info.tables || []).some((t) => t.status === 'pending_order')) {
      qs('new-order-sound')?.play().catch(() => {});
    }
    await loadData();
  }
}

(async function init() {
  adminUnlocked = window.localStorage.getItem('fakdu_admin_auth') === '1';
  syncAdminUI();
  bind();
  await loadData();
  setInterval(poll, 2500);
})();
