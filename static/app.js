let db;
let version = 0;
let selectedTableId = null;
let orderCart = [];
let activeCashierTableId = null;
let menuImagePreviewData = '';
let uiSoundEnabled = localStorage.getItem('uiSoundEnabled') !== '0';
let tableZoom = 100;
let editingMenuId = null;
let lastPendingTableIds = new Set();
let lastCheckoutRequestIds = new Set();
let activeOrderItemDraft = null;
let salesPeriod = 'day';
const RECOVERY_COLORS = ['แดง', 'ส้ม', 'เหลือง', 'เขียว', 'ฟ้า', 'น้ำเงิน', 'ม่วง'];
const CELEBRITIES = ['ณเดชน์ คูกิมิยะ', 'ญาญ่า อุรัสยา', 'ใหม่ ดาวิกา', 'มาริโอ้ เมาเร่อ', 'เบลล่า ราณี', 'ชมพู่ อารยา', 'อั้ม พัชราภา', 'แพนเค้ก เขมนิจ', 'เวียร์ ศุกลวัฒน์', 'โป๊ป ธนวรรธน์', 'เจมส์ จิรายุ', 'คิมเบอร์ลี่', 'บอย ปกรณ์', 'เต้ย จรินทร์พร', 'ใบเฟิร์น พิมพ์ชนก', 'โตโน่ ภาคิน', 'แพทริเซีย กู๊ด', 'แอฟ ทักษอร', 'นนกุล ชานน', 'กลัฟ คณาวุฒิ'];
const THEME_PRESETS = [
  { id: 'sunset', label: 'Sunset', primary: '#7c3aed', bg: '#f3f4f6', card: '#ffffff' },
  { id: 'forest', label: 'Forest', primary: '#047857', bg: '#ecfdf5', card: '#ffffff' },
  { id: 'ocean', label: 'Ocean', primary: '#0ea5e9', bg: '#ecfeff', card: '#ffffff' },
  { id: 'mono', label: 'Mono', primary: '#334155', bg: '#f8fafc', card: '#ffffff' },
];

const statusMap = {
  available: { label: 'ว่าง', tone: 'available', icon: '○' },
  pending_order: { label: 'กำลังสั่ง', tone: 'pending', icon: '🔔' },
  accepted_order: { label: 'รับออร์เดอร์แล้ว', tone: 'accepted', icon: '✅' },
  checkout_requested: { label: 'รอเช็คบิล', tone: 'checkout', icon: '🧾' },
};

const qs = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitLabel = () => (db?.settings?.serviceMode === 'queue' ? 'คิว' : 'โต๊ะ');
const qrApiBase = 'https://api.qrserver.com/v1/create-qr-code/';
let networkBaseUrl = document.body.dataset.localBaseUrl || '';
const scannerMode = document.body.dataset.scannerMode === '1';
const role = localStorage.getItem('user_role') || '';
const tableParam = Number(new URLSearchParams(window.location.search).get('table') || 0);
const scannerAllowedScreens = new Set(['customer', 'cashier']);

async function loadNetworkBaseUrl() {
  const network = await api('/api/system/network');
  if (!network.error && network.base_url) {
    networkBaseUrl = network.base_url;
    return;
  }
  if (!networkBaseUrl) {
    const ip = document.body.dataset.localIp || window.location.hostname;
    networkBaseUrl = `${window.location.protocol}//${ip}:${window.location.port || '5000'}`;
  }
}

function resolveRuntimeHost() {
  if (networkBaseUrl) return networkBaseUrl;
  const runtimeHost = window.location.hostname;
  const fallbackHost = document.body.dataset.localIp || runtimeHost;
  const host = (!runtimeHost || runtimeHost === 'localhost' || runtimeHost === '127.0.0.1') ? fallbackHost : runtimeHost;
  return `${window.location.protocol}//${host}:${window.location.port || '5000'}`;
}

function customerScanUrl(tableId) { return `${resolveRuntimeHost()}/customer?table=${tableId}`; }
function buildQrImageUrl(text) { return `${qrApiBase}?size=320x320&margin=8&data=${encodeURIComponent(text)}`; }
function playAlert(id) {
  if (!uiSoundEnabled) return;
  const audio = qs(id);
  if (!audio) return;
  audio.volume = 1;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function playUISound() {
  if (!uiSoundEnabled) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = 660;
  g.gain.value = 0.03;
  o.connect(g);
  g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.05);
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return res.ok ? data : { error: data.error || `request_failed_${res.status}` };
}

async function safeApi(path, options = {}) {
  try {
    return await api(path, options);
  } catch (error) {
    return { error: 'network_unreachable' };
  }
}

function setSystemCheckState(state, note = '') {
  const pill = qs('system-check-status');
  if (!pill) return;
  pill.classList.remove('is-online', 'is-offline', 'is-checking');
  pill.classList.add(`is-${state}`);
  pill.textContent = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'กำลังเช็ค...';
  const noteEl = qs('system-check-note');
  if (noteEl && note) noteEl.textContent = note;
}

async function checkSystemHealth() {
  setSystemCheckState('checking', 'กำลังตรวจสอบการเชื่อมต่อจาก /api/ping และ /api/system/network ...');
  const [ping, network] = await Promise.all([
    safeApi('/api/ping'),
    safeApi('/api/system/network'),
  ]);
  const online = !ping.error && !network.error;
  const serverStatus = qs('system-server-status');
  const serverUtc = qs('system-server-utc');
  const baseUrl = qs('system-base-url');
  const lanIp = qs('system-lan-ip');
  if (serverStatus) {
    serverStatus.textContent = online ? 'Online' : 'Offline';
    serverStatus.classList.toggle('system-server-online', online);
    serverStatus.classList.toggle('system-server-offline', !online);
  }
  if (serverUtc) serverUtc.textContent = ping.server_time || '-';
  if (baseUrl) baseUrl.textContent = network.base_url || resolveRuntimeHost();
  if (lanIp) lanIp.textContent = network.local_ip || document.body.dataset.localIp || '-';
  if (!online) {
    const fallbackReason = ping.error === 'network_unreachable' || network.error === 'network_unreachable'
      ? 'ไม่สามารถติดต่อเครือข่ายได้ (fallback mode)'
      : 'เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์ (fallback mode)';
    setSystemCheckState('offline', fallbackReason);
    return;
  }
  setSystemCheckState('online', 'ข้อมูลล่าสุดจากเซิร์ฟเวอร์พร้อมใช้งาน');
}

function showScreen(id) {
  if (scannerMode && !scannerAllowedScreens.has(id)) return;
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  qs(id).classList.remove('hidden');
  document.querySelectorAll('[data-screen]').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === id));
}


function applyRoleUI() {
  const tabBar = document.querySelector('.tab-bar');
  const tabButtons = [...document.querySelectorAll('[data-screen]')];

  if (role === 'staff') {
    tabButtons.forEach((button) => {
      const allowed = new Set(['customer', 'cashier']);
      const visible = allowed.has(button.dataset.screen);
      button.classList.toggle('hidden', !visible);
      button.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
    return;
  }

  if (tableParam > 0) {
    window.location.replace(`/customer?table=${encodeURIComponent(tableParam)}`);
    return;
  }

  if (tabBar) tabBar.classList.remove('hidden');
}

function applyScannerModeUI() {
  if (!scannerMode) return;
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    if (!scannerAllowedScreens.has(btn.dataset.screen)) {
      btn.classList.add('hidden');
      btn.setAttribute('aria-hidden', 'true');
    }
  });
  ['backstore', 'system'].forEach((screenId) => qs(screenId)?.classList.add('hidden'));
}

function applyTheme() {
  const s = db.settings || {};
  qs('header-store-name').textContent = s.storeName || 'FAKDU';
  qs('store-logo').innerHTML = s.logoImage ? `<img src="${s.logoImage}" alt="logo" />` : (s.logoName || 'LOGO');
  qs('shop-logo-preview').src = s.logoImage || '';
  document.documentElement.style.setProperty('--primary', s.themeColor || '#7c3aed');
  document.documentElement.style.setProperty('--bg', s.bgColor || '#f3f4f6');
  document.documentElement.style.setProperty('--card', s.cardColor || '#ffffff');
}

function getTableOrders(tableId) {
  return db.orders.filter((o) => o.target === 'table' && o.target_id === tableId && !['cancelled', 'completed'].includes(o.status));
}

function getTableSummary(tableId) {
  const orders = getTableOrders(tableId);
  const items = orders.flatMap((o) => o.items || []);
  const total = items.reduce((s, i) => s + (Number(i.price || 0) * Math.max(1, Number(i.qty || 1))), 0);
  return { items, total };
}

function normalizeAddonOptions(item) {
  if (Array.isArray(item?.addons)) return item.addons.filter(Boolean).map((value) => String(value).trim()).filter(Boolean);
  if (Array.isArray(item?.modifiers)) return item.modifiers.filter(Boolean).map((value) => String(value).trim()).filter(Boolean);
  if (typeof item?.addonOptions === 'string') return item.addonOptions.split(',').map((value) => value.trim()).filter(Boolean);
  if (Array.isArray(item?.addonOptions)) return item.addonOptions.filter(Boolean).map((value) => String(value).trim()).filter(Boolean);
  return [];
}

function parseAddonOption(rawOption = '') {
  const option = String(rawOption || '').trim();
  const explicitPrice = option.match(/\+\s*([\d]+(?:[.,][\d]+)?)/);
  const wrappedPrice = option.match(/\(\+\s*([\d]+(?:[.,][\d]+)?)\)\s*$/);
  const priceText = (wrappedPrice?.[1] || explicitPrice?.[1] || '0').replace(',', '.');
  const price = Number(priceText || 0);
  const cleanedName = option
    .replace(/\s*\(\+\s*[\d]+(?:[.,][\d]+)?\)\s*$/u, '')
    .replace(/\s*\+\s*[\d]+(?:[.,][\d]+)?\s*(บาท|baht)?\s*$/iu, '')
    .trim();
  return {
    name: cleanedName || option,
    price: Number.isFinite(price) ? price : 0,
    label: option,
  };
}

function orderCartIdentity(item) {
  const addonKey = (item.addons || [])
    .map((addon) => `${String(addon.name || '').trim()}:${Number(addon.price || 0)}`)
    .sort()
    .join('|');
  const baseId = item.item_id || item.id || item.name;
  return `${baseId}__${addonKey}__${(item.note || '').trim()}`;
}

function addItemToOrderCart(item, options = {}) {
  const selectedAddons = Array.isArray(options.addons) ? options.addons : [];
  const addonText = selectedAddons.map((addonItem) => addonItem.name).join(', ');
  const addonTotal = selectedAddons.reduce((sum, addonItem) => sum + Number(addonItem.price || 0), 0);
  const qty = Math.max(1, Number(options.qty || 1));
  const note = String(options.note || '').trim();
  const candidate = {
    id: item.id,
    item_id: item.id,
    name: item.name,
    base_price: Number(item.price || 0),
    price: Number(item.price || 0) + addonTotal,
    addon: addonText,
    addons: selectedAddons,
    note,
    qty,
  };
  const key = orderCartIdentity(candidate);
  const existing = orderCart.find((entry) => orderCartIdentity(entry) === key);
  if (existing) {
    existing.qty += qty;
  } else {
    orderCart.push(candidate);
  }
  renderOrderCart();
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
         <small></small>`;
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
      const addonOptions = normalizeAddonOptions(item);
      if (!addonOptions.length) {
        addItemToOrderCart(item, { addons: [], qty: 1, note: '' });
        return;
      }
      activeOrderItemDraft = item;
      qs('order-item-detail-title').textContent = item.name;
      const addonWrap = qs('order-item-addon-checkboxes');
      addonWrap.innerHTML = '';
      addonOptions.forEach((option) => {
        const row = document.createElement('label');
        row.className = 'addon-check-item';
        row.innerHTML = `<input type="checkbox" value="${option}" /> <span>${option}</span>`;
        addonWrap.appendChild(row);
      });
      qs('order-item-detail-modal').classList.remove('hidden');
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
    const qty = Math.max(1, Number(item.qty || 1));
    const lineTotal = Number(item.price || 0) * qty;
    row.innerHTML = `<strong>${item.name}${qty > 1 ? ` x${qty}` : ''}</strong> · ${money(lineTotal)} บาท ${item.addon ? `<small>(${item.addon})</small>` : ''} <button class="btn-soft btn-danger icon-delete" aria-label="ลบรายการ" type="button">✕</button>`;
    row.querySelector('button').addEventListener('click', () => { orderCart.splice(idx, 1); renderOrderCart(); });
    list.appendChild(row);
  });
  qs('order-cart-total').textContent = `รวม ${money(orderCart.reduce((s, i) => s + (Number(i.price || 0) * Math.max(1, Number(i.qty || 1))), 0))} บาท`;
}

function summarizeItems(items = []) {
  const itemMap = new Map();
  items.forEach((item) => {
    const key = `${item.name}|${item.addon || ''}|${item.note || ''}|${Number(item.price || 0)}`;
    if (!itemMap.has(key)) {
      itemMap.set(key, { ...item, qty: 0 });
    }
    const current = itemMap.get(key);
    current.qty += Math.max(1, Number(item.qty || 1));
  });
  return Array.from(itemMap.values());
}

function formatClock(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function renderExistingOrders(tableId) {
  const list = qs('order-existing-list');
  list.innerHTML = '';
  const orders = getTableOrders(tableId);
  const rawItems = orders.flatMap((o) => o.items || []);
  const total = rawItems.reduce((sum, item) => sum + (Number(item.price || 0) * Math.max(1, Number(item.qty || 1))), 0);
  const stackedItems = summarizeItems(rawItems);
  if (!orders.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการที่สั่งแล้ว</div>';
  }
  stackedItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    const qtyText = Math.max(1, Number(item.qty || 1)) > 1 ? ` x${Math.max(1, Number(item.qty || 1))}` : '';
    row.innerHTML = `<strong>${item.name}${qtyText}</strong> • ${money(item.price)} บาท <span class="pill">sent</span>`;
    list.appendChild(row);
  });
  qs('order-existing-total').textContent = `ยอดรวมตอนนี้ ${money(total)} บาท`;
}

function renderDeskSummary() {
  const metaNode = qs('desk-selected-table');
  const statusNode = qs('desk-selected-status');
  const list = qs('desk-selected-items');
  const totalNode = qs('desk-selected-total');
  const acceptBtn = qs('desk-accept-order');
  if (!metaNode || !statusNode || !list || !totalNode) return;

  if (!selectedTableId) {
    metaNode.textContent = 'ยังไม่ได้เลือกโต๊ะ';
    statusNode.textContent = 'เลือกโต๊ะเพื่อดูสรุปคำสั่งซื้อ';
    list.innerHTML = '<div class="empty">ยังไม่มีข้อมูล</div>';
    totalNode.textContent = 'รวม 0.00 บาท';
    if (acceptBtn) acceptBtn.disabled = true;
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
  const hasCustomerNewOrder = getTableOrders(selectedTableId).some((o) => o.source === 'customer' && o.status === 'pending');
  if (acceptBtn) {
    acceptBtn.disabled = !hasCustomerNewOrder || total <= 0;
    acceptBtn.textContent = hasCustomerNewOrder ? '✅ ยืนยันรับออร์เดอร์ (Accept Order)' : '✅ รับออเดอร์แล้ว';
  }
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
  const subtotal = orderCart.reduce((sum, item) => sum + (Number(item.price || 0) * Math.max(1, Number(item.qty || 1))), 0);
  const res = await api('/api/order', {
    method: 'POST',
    body: JSON.stringify({
      target: 'table',
      target_id: selectedTableId,
      cart: orderCart,
      source: 'staff',
      subtotal,
      total_price: subtotal,
    }),
  });
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
  if (!bill.items.length) {
    qs('bill-items').innerHTML = '<div class="empty">ยังไม่มีรายการค้างชำระ</div>';
  }
  bill.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'bill-row-item';
    row.innerHTML = `<strong>${item.name}</strong><span>฿${money(item.price)}</span>`;
    qs('bill-items').appendChild(row);
  });
  qs('bill-total').textContent = money(bill.total);
  const paymentImage = db.settings?.qrImage || buildPromptPayQrImage(db.settings?.promptPay || '', Number(bill.total || 0), Boolean(db.settings?.dynamicPromptPay));
  qs('bill-payment-qr-image').src = paymentImage;
  qs('bill-payment-qr-wrap').classList.add('hidden');
  qs('payment-modal').classList.remove('hidden');
}

function openCustomerDisplayWindow(tableId) {
  if (!tableId) return;
  const popup = window.open(`/customer-display?table=${encodeURIComponent(tableId)}`, 'customer-bill-display');
  if (popup) popup.focus();
}

function sanitizePromptPay(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function crc16ccitt(input) {
  let crc = 0xFFFF;
  for (let c = 0; c < input.length; c += 1) {
    crc ^= input.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id, value) {
  const val = String(value);
  return `${id}${String(val.length).padStart(2, '0')}${val}`;
}

function buildPromptPayPayload(promptPayId, amount = 0, dynamic = true) {
  const id = sanitizePromptPay(promptPayId);
  if (!id) return '';
  const formattedId = id.length === 10 && id.startsWith('0') ? `0066${id.slice(1)}` : id;
  const merchantInfo = `0016A000000677010111${tlv('01', formattedId)}`;
  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('01', dynamic ? '12' : '11');
  payload += tlv('29', merchantInfo);
  payload += tlv('58', 'TH');
  payload += tlv('53', '764');
  if (dynamic && amount > 0) payload += tlv('54', Number(amount).toFixed(2));
  payload += tlv('63', '');
  return payload + crc16ccitt(payload);
}

function buildPromptPayQrImage(promptPayId, amount, dynamic) {
  const payload = buildPromptPayPayload(promptPayId, amount, dynamic);
  if (!payload) return buildQrImageUrl('promptpay-not-configured');
  return buildQrImageUrl(payload);
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
    const tableOrders = getTableOrders(table.id);
    const { items, total } = getTableSummary(table.id);
    const groupedItems = summarizeItems(items);
    const orderTimes = tableOrders
      .map((order) => new Date(order.created_at || order.updated_at || 0).getTime())
      .filter((stamp) => Number.isFinite(stamp) && stamp > 0)
      .sort((a, b) => b - a);
    const hasExtraOrder = tableOrders.length > 1;
    const row = document.createElement('button');
    row.className = `list-card checkout-card ${meta.tone}`;
    row.innerHTML = `<strong class="checkout-title">${meta.icon} ${unitLabel()} ${table.id}</strong>
      <small>${table.status === 'available' ? '' : meta.label}</small>
      <div class="checkout-meta-row">
        <span class="pill">🕒 ${formatClock(orderTimes[0])}</span>
        ${hasExtraOrder ? '<span class="pill">➕ สั่งเพิ่ม</span>' : ''}
      </div>
      <div class="checkout-items">${groupedItems.length ? groupedItems.slice(-5).map((i) => {
    const qty = Math.max(1, Number(i.qty || 1));
    const thumb = i.image ? `<img src="${i.image}" alt="${i.name}" class="checkout-item-thumb" />` : '<span class="checkout-item-thumb fallback">🍽️</span>';
    return `<div class="checkout-item-row">${thumb}<span>${i.name}${qty > 1 ? ` x${qty}` : ''}</span></div>`;
  }).join('') : ''}</div>
      <strong>รวม ${money(total)} บาท</strong>`;
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
    row.innerHTML = `<div class="menu-admin-meta"><div class="menu-thumb">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : 'IMG'}</div><div><strong>${item.name}</strong><small>${money(item.price)} บาท</small></div></div><div class="btn-row"><button data-a="e" class="btn-soft">แก้ไข</button><button data-a="d" class="btn-soft">ลบ</button></div>`;
    row.querySelector('[data-a="e"]').addEventListener('click', () => openEditMenuModal(item));
    row.querySelector('[data-a="d"]').addEventListener('click', async () => { db.menu.splice(idx, 1); await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) }); await loadData(); });
    list.appendChild(row);
  });
}

function resetMenuModal() {
  editingMenuId = null;
  qs('menu-modal').querySelector('h3').textContent = 'Add Menu';
  qs('menu-name').value = '';
  qs('menu-price').value = '';
  qs('addon-rows').innerHTML = '';
  qs('menu-image-file').value = '';
  qs('menu-image-preview').src = '';
  qs('menu-image-preview').classList.add('hidden');
  menuImagePreviewData = '';
}

function openEditMenuModal(item) {
  editingMenuId = item.id;
  qs('menu-modal').querySelector('h3').textContent = 'Edit Menu';
  qs('menu-name').value = item.name || '';
  qs('menu-price').value = Number(item.price || 0);
  qs('addon-rows').innerHTML = '';
  const addonRows = item.addon_json || [];
  if (addonRows.length) addonRows.forEach((addon) => addAddonRow(addon));
  else if ((item.addons || []).length) item.addons.forEach((addonText) => addAddonRow({ name: String(addonText), price: 0 }));
  else addAddonRow();
  menuImagePreviewData = item.image || '';
  qs('menu-image-preview').src = menuImagePreviewData;
  qs('menu-image-preview').classList.toggle('hidden', !menuImagePreviewData);
  qs('menu-modal').classList.remove('hidden');
}

function salesDate(record) {
  return new Date(record.paid_at || record.timestamp || record.created_at || Date.now());
}

function periodRange(period, now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  if (period === 'day') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, previousStart: new Date(start.getTime() - (24 * 60 * 60 * 1000)), previousEnd: new Date(end.getTime() - (24 * 60 * 60 * 1000)), label: 'วันนี้', compareLabel: 'เมื่อวาน' };
  }
  if (period === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime() + (7 * 24 * 60 * 60 * 1000) - 1);
    return { start, end, previousStart: new Date(start.getTime() - (7 * 24 * 60 * 60 * 1000)), previousEnd: new Date(end.getTime() - (7 * 24 * 60 * 60 * 1000)), label: 'สัปดาห์นี้', compareLabel: 'สัปดาห์ที่แล้ว' };
  }
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  end.setMonth(start.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  const previousStart = new Date(start);
  previousStart.setMonth(previousStart.getMonth() - 1);
  const previousEnd = new Date(start.getTime() - 1);
  return { start, end, previousStart, previousEnd, label: 'เดือนนี้', compareLabel: 'เดือนที่แล้ว' };
}

function renderSales() {
  const sales = db.sales || [];
  const range = periodRange(salesPeriod, new Date());
  const inCurrent = sales.filter((s) => salesDate(s) >= range.start && salesDate(s) <= range.end);
  const inPrevious = sales.filter((s) => salesDate(s) >= range.previousStart && salesDate(s) <= range.previousEnd);
  const currentTotal = inCurrent.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const previousTotal = inPrevious.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const diff = currentTotal - previousTotal;
  const percent = previousTotal > 0 ? (diff / previousTotal) * 100 : (currentTotal > 0 ? 100 : 0);
  const cash = inCurrent.filter((s) => s.payment_method === 'cash').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const qr = inCurrent.filter((s) => s.payment_method === 'qr').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const sign = diff >= 0 ? '+' : '-';
  const trendClass = diff >= 0 ? 'up' : 'down';
  qs('sales-comparison').innerHTML = `<strong>${range.label} เทียบ ${range.compareLabel}</strong><div class="sales-compare-value ${trendClass}">${sign}฿${money(Math.abs(diff))} (${sign}${Math.abs(percent).toFixed(1)}%)</div>`;
  qs('sales-overview').innerHTML = `<div class="list-card sales-kpi total"><strong>ยอดรวม</strong><div>฿${money(currentTotal)}</div></div><div class="list-card sales-kpi"><strong>เงินสด</strong><div>฿${money(cash)}</div></div><div class="list-card sales-kpi"><strong>QR</strong><div>฿${money(qr)}</div></div><div class="list-card sales-kpi"><strong>จำนวนบิล</strong><div>${inCurrent.length}</div></div>`;
  const chart = qs('sales-chart');
  const bucket = {};
  inCurrent.forEach((sale) => {
    const d = salesDate(sale);
    const key = salesPeriod === 'month' ? `${d.getDate()}` : (salesPeriod === 'week' ? d.toLocaleDateString('th-TH', { weekday: 'short' }) : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 2));
    bucket[key] = (bucket[key] || 0) + Number(sale.total || 0);
  });
  const points = Object.entries(bucket);
  const max = Math.max(1, ...points.map(([, val]) => val));
  chart.innerHTML = points.map(([label, val]) => `<div class="chart-col"><div class="chart-bar" style="height:${Math.max(10, (val / max) * 100)}%"></div><small>${label}</small></div>`).join('') || '<div class="empty">ยังไม่มีข้อมูลยอดขายในช่วงนี้</div>';
  const body = qs('sales-list');
  body.innerHTML = '';
  inCurrent.slice().sort((a, b) => salesDate(b) - salesDate(a)).forEach((sale) => {
    const isCash = sale.payment_method === 'cash';
    const card = document.createElement('article');
    card.className = 'list-card sales-row-card';
    card.innerHTML = `<div class="sales-row-head"><strong>${unitLabel()} ${sale.target_id}</strong><strong>฿${money(sale.total)}</strong></div>
      <small>🕒 ${new Date(sale.paid_at || Date.now()).toLocaleString('th-TH')}</small>
      <div class="sales-row-foot"><span class="sales-pay-icon">${isCash ? '💵' : '📱'}</span><small>${isCash ? 'เงินสด' : 'โอน'}</small></div>`;
    body.appendChild(card);
  });
}

async function renderBestSellers() {
  const bestWrap = qs('sales-best-list');
  if (!bestWrap) return;
  const best = await api('/api/sales/best-sellers');
  bestWrap.innerHTML = '';
  if (best.error) {
    bestWrap.innerHTML = '<div class="empty">โหลดเมนูยอดฮิตไม่สำเร็จ</div>';
    return;
  }
  const items = best.items || [];
  if (!items.length) {
    bestWrap.innerHTML = '<div class="empty">ยังไม่มีข้อมูลเมนูยอดฮิต</div>';
    return;
  }
  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `<strong>${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔥'} ${item.name}</strong><small>x${item.qty}</small>`;
    bestWrap.appendChild(row);
  });
}

function renderSystem() {
  const s = db.settings || {};
  qs('table-count').value = db.tableCount || 8;
  qs('service-mode').value = s.serviceMode || 'table';
  qs('store-name').value = s.storeName || 'FAKDU';
  qs('bank-name').value = s.bankName || '';
  qs('promptpay').value = s.promptPay || '';
  qs('auto-print').checked = Boolean(s.autoPrint);
  qs('paper-size').value = s.paperSize || '58';
  qs('dynamic-qr').checked = Boolean(s.dynamicPromptPay);
  qs('admin-recovery-phone').value = s.adminRecoveryPhone || '';
  setSelectOptions('admin-recovery-color', RECOVERY_COLORS, s.adminRecoveryColor || '');
  setSelectOptions('admin-recovery-celebrity', CELEBRITIES, s.adminRecoveryCelebrity || '');
  setSelectOptions('forgot-color', RECOVERY_COLORS, '');
  setSelectOptions('forgot-celebrity', CELEBRITIES, '');
  qs('theme-primary').value = s.themeColor || '#7c3aed';
  qs('theme-bg').value = s.bgColor || '#f3f4f6';
  qs('theme-card').value = s.cardColor || '#ffffff';
  renderPrinterDriverOptions(s.printerDriver || '');
  renderThemePresets(s.themePreset || '');
  updateReceiptPreview();
  renderTableQRList();
  const displaySelect = qs('customer-display-table-select');
  if (displaySelect) {
    const count = Number(db.tableCount || 0);
    displaySelect.innerHTML = '';
    for (let i = 1; i <= count; i += 1) {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = `${unitLabel()} ${i}`;
      displaySelect.appendChild(option);
    }
  }
}

function renderPrinterDriverOptions(selectedDriver) {
  const node = qs('printer-driver');
  if (!node) return;
  const drivers = ['Default System Printer', 'POS-USB-58mm', 'POS-LAN-80mm', 'Microsoft Print to PDF'];
  node.innerHTML = '';
  drivers.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    opt.selected = name === selectedDriver;
    node.appendChild(opt);
  });
}

function updateReceiptPreview() {
  const paperSize = qs('paper-size')?.value || '58';
  const preview = qs('receipt-preview');
  preview.dataset.paperSize = paperSize;
  const storeName = qs('store-name')?.value.trim() || 'FAKDU POS';
  const brand = preview.querySelector('.receipt-brand');
  if (brand) brand.textContent = storeName;
  const datetime = new Date();
  const dateText = datetime.toLocaleString('th-TH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  qs('receipt-preview-datetime').textContent = `วันที่/เวลา: ${dateText}`;
}

function setSelectOptions(id, options, selectedValue) {
  const node = qs(id);
  node.innerHTML = '<option value="">-- เลือก --</option>';
  options.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.selected = name === selectedValue;
    node.appendChild(option);
  });
}

function renderThemePresets(activePresetId) {
  const wrap = qs('theme-preset-list');
  wrap.innerHTML = '';
  THEME_PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theme-preset ${activePresetId === preset.id ? 'is-active' : ''}`;
    btn.dataset.presetId = preset.id;
    btn.innerHTML = `<span class="theme-dot" style="background:${preset.primary}"></span>${preset.label}`;
    btn.addEventListener('click', () => {
      qs('theme-primary').value = preset.primary;
      qs('theme-bg').value = preset.bg;
      qs('theme-card').value = preset.card;
      document.querySelectorAll('.theme-preset').forEach((node) => node.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
    wrap.appendChild(btn);
  });
}

function openQRModal(title, url, imageUrl) {
  qs('qr-modal-title').textContent = title;
  qs('client-qr-image').src = imageUrl;
  qs('qr-modal-link').textContent = url;
  qs('qr-modal-link').href = url;
  qs('qr-download').href = imageUrl;
  qs('qr-download').download = `${title}.png`;
  qs('qr-print').onclick = () => {
    const printWindow = window.open('', '_blank', 'width=500,height=700');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>${title}</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:24px">
        <h3>${title}</h3>
        <img src="${imageUrl}" style="width:300px;height:300px" />
        <p>${url}</p>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  qs('qr-modal').classList.remove('hidden');
}

function renderTableQRList() {
  const select = qs('table-qr-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- เลือกโต๊ะ --</option>';
  db.tables.forEach((table) => {
    const option = document.createElement('option');
    option.value = String(table.id);
    option.textContent = `Table ${table.id}`;
    select.appendChild(option);
  });
  renderSelectedTableQR(select.value);
}

function renderSelectedTableQR(tableId) {
  const wrap = qs('table-qr-preview');
  const image = qs('table-qr-image');
  const link = qs('table-qr-link');
  if (!wrap || !image || !link) return;
  if (!tableId) {
    wrap.classList.add('hidden');
    image.src = '';
    link.textContent = '';
    link.href = '';
    return;
  }
  const url = customerScanUrl(Number(tableId));
  image.src = buildQrImageUrl(url);
  link.textContent = url;
  link.href = url;
  wrap.classList.remove('hidden');
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
  await renderBestSellers();
  renderSystem();
  await checkSystemHealth();
  renderDeskSummary();
  updateNetworkStatus(true);
}

function updateNetworkStatus(online) {
  const dot = qs('network-status-dot');
  if (!dot) return;
  dot.classList.toggle('online', online);
  dot.classList.toggle('offline', !online);
  dot.title = online ? 'Online' : 'Offline';
}

let addAddonRow = () => {};

function bind() {
  document.querySelectorAll('[data-screen]').forEach((btn) => btn.addEventListener('click', () => showScreen(btn.dataset.screen)));
  document.querySelectorAll('[data-backstore-tab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-backstore-tab]').forEach((s) => s.classList.toggle('is-active', s === btn));
    ['menu', 'sales'].forEach((name) => qs(`backstore-${name}`).classList.toggle('hidden', name !== btn.dataset.backstoreTab));
  }));
  document.querySelectorAll('[data-sales-tab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sales-tab]').forEach((s) => s.classList.toggle('is-active', s === btn));
    ['history', 'best'].forEach((name) => qs(`sales-tab-${name}`)?.classList.toggle('hidden', name !== btn.dataset.salesTab));
  }));

  qs('close-qr-modal').addEventListener('click', () => qs('qr-modal').classList.add('hidden'));
  qs('close-forgot-admin-modal').addEventListener('click', () => qs('forgot-admin-modal').classList.add('hidden'));
  qs('close-table-order-modal').addEventListener('click', () => qs('table-order-modal').classList.add('hidden'));
  qs('close-order-item-detail-modal')?.addEventListener('click', () => {
    activeOrderItemDraft = null;
    qs('order-item-detail-modal').classList.add('hidden');
  });
  qs('order-item-detail-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'order-item-detail-modal') {
      activeOrderItemDraft = null;
      qs('order-item-detail-modal').classList.add('hidden');
    }
  });
  qs('order-item-detail-add-btn')?.addEventListener('click', () => {
    if (!activeOrderItemDraft) return;
    const checked = [...document.querySelectorAll('#order-item-addon-checkboxes input[type="checkbox"]:checked')]
      .map((node) => node.value.trim())
      .filter(Boolean);
    const selectedAddons = checked.map((label) => parseAddonOption(label));
    addItemToOrderCart(activeOrderItemDraft, { addons: selectedAddons, qty: 1, note: '' });
    activeOrderItemDraft = null;
    qs('order-item-detail-modal').classList.add('hidden');
  });
  qs('close-payment-modal').addEventListener('click', () => {
    qs('bill-payment-qr-wrap')?.classList.add('hidden');
    qs('payment-modal').classList.add('hidden');
  });
  qs('open-receipt-preview')?.addEventListener('click', () => qs('receipt-preview-modal').classList.remove('hidden'));
  qs('close-receipt-preview')?.addEventListener('click', () => qs('receipt-preview-modal').classList.add('hidden'));
  document.querySelectorAll('[data-sales-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      salesPeriod = btn.dataset.salesPeriod || 'day';
      document.querySelectorAll('[data-sales-period]').forEach((node) => node.classList.toggle('is-active', node === btn));
      renderSales();
    });
  });
  qs('paper-size')?.addEventListener('change', updateReceiptPreview);
  qs('store-name')?.addEventListener('input', updateReceiptPreview);

  qs('order-submit').addEventListener('click', submitOrderFromPanel);

  qs('bill-pay-cash').addEventListener('click', async () => {
    if (!activeCashierTableId) return;
    await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: activeCashierTableId, payment_method: 'cash' }) });
    qs('payment-modal').classList.add('hidden');
    await loadData();
  });
  qs('bill-pay-qr').addEventListener('click', async () => {
    if (!activeCashierTableId) return;
    qs('bill-payment-qr-wrap')?.classList.remove('hidden');
    await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: activeCashierTableId, payment_method: 'qr' }) });
    qs('payment-modal').classList.add('hidden');
    await loadData();
  });
  qs('open-customer-display-from-header')?.addEventListener('click', () => {
    const tableId = activeCashierTableId || selectedTableId;
    if (!tableId) return;
    openCustomerDisplayWindow(tableId);
  });
  qs('open-customer-display-mode')?.addEventListener('click', () => {
    const tableId = Number(qs('customer-display-table-select')?.value || 0);
    if (!tableId) return;
    openCustomerDisplayWindow(tableId);
  });

  qs('update-table-count').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount: Number(qs('table-count').value), settings: { serviceMode: qs('service-mode').value } }) });
    await loadData();
  });

  addAddonRow = (addon = { name: '', price: 0 }) => {
    const row = document.createElement('div');
    row.className = 'form-grid three-col';
    row.innerHTML = `<input class="addon-name" placeholder="ชื่อ Add-on" value="${addon.name || ''}" /><input class="addon-price" type="number" min="0" placeholder="ราคาเพิ่ม" value="${addon.price || 0}" /><button class="btn-soft" type="button">ลบ</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    qs('addon-rows').appendChild(row);
  };
  qs('open-menu-modal')?.addEventListener('click', () => { resetMenuModal(); qs('menu-modal').classList.remove('hidden'); if (!qs('addon-rows').children.length) addAddonRow(); });
  qs('close-menu-modal')?.addEventListener('click', () => { qs('menu-modal').classList.add('hidden'); resetMenuModal(); });
  qs('add-addon-row')?.addEventListener('click', () => addAddonRow());

  qs('menu-image-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    menuImagePreviewData = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
    const compressed = await api('/api/menu/upload-image', { method: 'POST', body: JSON.stringify({ image: menuImagePreviewData }) });
    menuImagePreviewData = compressed.image || menuImagePreviewData;
    qs('menu-image-preview').src = menuImagePreviewData;
    qs('menu-image-preview').classList.remove('hidden');
  });

  qs('save-menu').addEventListener('click', async () => {
    const name = qs('menu-name').value.trim();
    const price = Number(qs('menu-price').value || 0);
    if (!name || price <= 0) return;
    const addons = [...document.querySelectorAll('#addon-rows .form-grid')].map((row) => ({ name: row.querySelector('.addon-name').value.trim(), price: Number(row.querySelector('.addon-price').value || 0) })).filter((a) => a.name);
    const payload = { name, price, addons: addons.map((a) => `${a.name} (+${a.price})`), addon_json: addons, image: menuImagePreviewData || '' };
    if (editingMenuId) {
      const targetIndex = db.menu.findIndex((item) => item.id === editingMenuId);
      if (targetIndex >= 0) db.menu[targetIndex] = { ...db.menu[targetIndex], ...payload, id: editingMenuId };
    } else {
      db.menu.push({ id: Date.now(), ...payload });
    }
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) });
    qs('menu-modal').classList.add('hidden');
    resetMenuModal();
    await loadData();
  });

  qs('shop-logo-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
    qs('shop-logo-preview').src = dataUrl;
  });

  qs('desk-accept-order')?.addEventListener('click', async () => {
    if (!selectedTableId) return;
    await api('/api/table/accept', { method: 'POST', body: JSON.stringify({ table_id: selectedTableId }) });
    await loadData();
  });

  qs('desk-open-order-modal')?.addEventListener('click', () => { if (selectedTableId) selectTable(selectedTableId); });
  qs('open-sales-insight')?.addEventListener('click', () => {
    const sales = db.sales || [];
    const sum = (days) => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(now.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
      return sales.filter((s) => new Date(s.timestamp || s.created_at || Date.now()) >= start).reduce((a, b) => a + Number(b.total || 0), 0);
    };
    const now7 = sum(7);
    const prevStart = new Date();
    prevStart.setDate(prevStart.getDate() - 14);
    prevStart.setHours(0, 0, 0, 0);
    const prevEnd = new Date();
    prevEnd.setDate(prevEnd.getDate() - 8);
    prevEnd.setHours(23, 59, 59, 999);
    const prev7 = sales.filter((s) => {
      const d = new Date(s.timestamp || s.created_at || Date.now());
      return d >= prevStart && d <= prevEnd;
    }).reduce((a, b) => a + Number(b.total || 0), 0);
    const diff = now7 - prev7;
    const best = {};
    sales.forEach((sale) => (sale.items || []).forEach((it) => { best[it.name] = (best[it.name] || 0) + 1; }));
    const top = Object.entries(best).sort((a, b) => b[1] - a[1]).slice(0, 3);
    qs('insight-content').innerHTML = `
      <div class="list-card"><strong>7 วันล่าสุด</strong><div>${money(now7)} บาท</div></div>
      <div class="list-card"><strong>เทียบ 7 วันก่อนหน้า</strong><div>${diff >= 0 ? '+' : ''}${money(diff)} บาท</div></div>
      <div class="list-card"><strong>Top items</strong><div>${top.map((x) => `${x[0]} (${x[1]})`).join('<br>') || 'ไม่มีข้อมูล'}</div></div>`;
    qs('insight-modal').classList.remove('hidden');
  });
  qs('close-insight-modal')?.addEventListener('click', () => qs('insight-modal').classList.add('hidden'));
  qs('open-forgot-admin-modal')?.addEventListener('click', () => {
    qs('forgot-phone').value = '';
    qs('forgot-color').value = '';
    qs('forgot-celebrity').value = '';
    qs('new-admin-pin').value = '';
    qs('forgot-admin-modal').classList.remove('hidden');
  });
  qs('reset-admin-pin')?.addEventListener('click', async () => {
    const s = db.settings || {};
    const phoneOk = qs('forgot-phone').value.trim() && qs('forgot-phone').value.trim() === (s.adminRecoveryPhone || '');
    const colorOk = qs('forgot-color').value === (s.adminRecoveryColor || '');
    const celebOk = qs('forgot-celebrity').value === (s.adminRecoveryCelebrity || '');
    const newPin = qs('new-admin-pin').value.trim();
    if (!phoneOk || !colorOk || !celebOk || !newPin) {
      alert('ข้อมูลยืนยันไม่ถูกต้อง หรือยังไม่ได้กรอกรหัสใหม่');
      return;
    }
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: { adminPin: newPin } }) });
    qs('forgot-admin-modal').classList.add('hidden');
    alert('รีเซ็ตรหัส Admin สำเร็จ');
    await loadData();
  });

  document.body.addEventListener('click', (event) => { if (event.target.closest('button')) playUISound(); });
  const soundToggle = qs('ui-sound-toggle');
  if (soundToggle) {
    soundToggle.checked = uiSoundEnabled;
    qs('ui-sound-label').textContent = uiSoundEnabled ? '🔊' : '🔇';
    soundToggle.addEventListener('change', () => {
      uiSoundEnabled = soundToggle.checked;
      localStorage.setItem('uiSoundEnabled', uiSoundEnabled ? '1' : '0');
      qs('ui-sound-label').textContent = uiSoundEnabled ? '🔊' : '🔇';
    });
  }
  const applyTableZoom = () => document.documentElement.style.setProperty('--table-scale', tableZoom / 100);
  qs('table-zoom-in')?.addEventListener('click', () => { tableZoom = Math.min(140, tableZoom + 10); applyTableZoom(); });
  qs('table-zoom-out')?.addEventListener('click', () => { tableZoom = Math.max(85, tableZoom - 10); applyTableZoom(); });
  qs('open-staff-qr-modal')?.addEventListener('click', () => {
    const url = `${resolveRuntimeHost()}/scan/staff`;
    openQRModal('Staff-Access', url, buildQrImageUrl(url));
  });
  qs('table-qr-select')?.addEventListener('change', (event) => {
    renderSelectedTableQR(event.target.value);
  });
  qs('recheck-system')?.addEventListener('click', checkSystemHealth);

  qs('save-system').addEventListener('click', async () => {
    let qrImage = db.settings?.qrImage || '';
    const logoImage = qs('shop-logo-preview').src || db.settings?.logoImage || '';
    const qrFile = qs('qr-image').files?.[0];
    if (qrFile) qrImage = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(qrFile); });
    const activeThemePreset = document.querySelector('.theme-preset.is-active')?.dataset.presetId || 'custom';
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        settings: {
          storeName: qs('store-name').value.trim(),
          bankName: qs('bank-name').value.trim(),
          promptPay: qs('promptpay').value.trim(),
          autoPrint: qs('auto-print').checked,
          paperSize: qs('paper-size').value,
          dynamicPromptPay: qs('dynamic-qr').checked,
          printerDriver: qs('printer-driver').value,
          qrImage,
          logoImage,
          adminRecoveryPhone: qs('admin-recovery-phone').value.trim(),
          adminRecoveryColor: qs('admin-recovery-color').value,
          adminRecoveryCelebrity: qs('admin-recovery-celebrity').value,
          themeColor: qs('theme-primary').value,
          bgColor: qs('theme-bg').value,
          cardColor: qs('theme-card').value,
          themePreset: activeThemePreset,
        },
      }),
    });
    await loadData();
  });

  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  }));
}

async function poll() {
  const info = await api(`/api/staff/live?since=${version}`);
  if (info.error) {
    updateNetworkStatus(false);
    return;
  }
  updateNetworkStatus(true);
  if (info.changed) {
    const pendingSet = new Set((info.tables || []).filter((t) => t.status === 'pending_order').map((t) => t.id));
    const checkoutSet = new Set((info.tables || []).filter((t) => t.status === 'checkout_requested').map((t) => t.id));
    const hasNewPending = [...pendingSet].some((id) => !lastPendingTableIds.has(id));
    const hasNewCheckoutRequest = [...checkoutSet].some((id) => !lastCheckoutRequestIds.has(id));
    if (hasNewPending) playAlert('new-order-sound');
    if (hasNewCheckoutRequest) playAlert('checkout-request-sound');
    lastPendingTableIds = pendingSet;
    lastCheckoutRequestIds = checkoutSet;
    await loadData();
  }
}

(async function init() {
  applyRoleUI();
  applyScannerModeUI();
  bind();
  await loadNetworkBaseUrl();
  await loadData();
  if (scannerMode || role === 'staff') showScreen('customer');
  if (role === 'staff' && tableParam > 0) selectTable(tableParam);
  setInterval(poll, 3000);
})();
