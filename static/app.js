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
let activeOrderItemDraftQty = 1;
let acceptRequestInFlight = false;
const requestActionInFlight = new Set();
let orderMenuRenderToken = 0;
let salesPeriod = 'day';
let salesFilterRange = null;
let activeMenuCategory = 'ทั้งหมด';
let activeBackstoreMenuCategory = 'ทั้งหมด';
const CUSTOMER_DISPLAY_ACTIVE_TABLE_KEY = 'customer_display_active_table';
const BACKUP_SNAPSHOTS_KEY = 'pos_backup_snapshots_v1';
const RECOVERY_COLORS = ['แดง', 'ส้ม', 'เหลือง', 'เขียว', 'ฟ้า', 'น้ำเงิน', 'ม่วง'];
const CELEBRITIES = ['ณเดชน์ คูกิมิยะ', 'ญาญ่า อุรัสยา', 'ใหม่ ดาวิกา', 'มาริโอ้ เมาเร่อ', 'เบลล่า ราณี', 'ชมพู่ อารยา', 'อั้ม พัชราภา', 'แพนเค้ก เขมนิจ', 'เวียร์ ศุกลวัฒน์', 'โป๊ป ธนวรรธน์', 'เจมส์ จิรายุ', 'คิมเบอร์ลี่', 'บอย ปกรณ์', 'เต้ย จรินทร์พร', 'ใบเฟิร์น พิมพ์ชนก', 'โตโน่ ภาคิน', 'แพทริเซีย กู๊ด', 'แอฟ ทักษอร', 'นนกุล ชานน', 'กลัฟ คณาวุฒิ'];
const THEME_PRESETS = [
  { id: 'sunset', label: 'Sunset', primary: '#7c3aed', bg: '#f3f4f6', card: '#ffffff' },
  { id: 'forest', label: 'Forest', primary: '#047857', bg: '#ecfdf5', card: '#ffffff' },
  { id: 'ocean', label: 'Ocean', primary: '#0ea5e9', bg: '#ecfeff', card: '#ffffff' },
  { id: 'mono', label: 'Mono', primary: '#334155', bg: '#f8fafc', card: '#ffffff' },
];
const DEFAULT_MENU_CATEGORIES = ['ทั่วไป', 'อาหารจานหลัก', 'ของทานเล่น', 'เครื่องดื่ม', 'ของหวาน'];

const statusMap = {
  available: { label: 'ว่าง', tone: 'available', icon: '○' },
  pending_order: { label: 'กำลังรับออร์เดอร์', tone: 'pending', icon: '🔔' },
  accepted_order: { label: 'มีลูกค้า', tone: 'accepted', icon: '✅' },
  checkout_requested: { label: 'เรียกเช็คบิล', tone: 'checkout', icon: '🧾' },
};

const qs = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const unitLabel = () => (db?.settings?.serviceMode === 'queue' ? 'คิว' : 'โต๊ะ');
let networkBaseUrl = document.body.dataset.localBaseUrl || '';
let liveEventSource = null;
const scannerMode = document.body.dataset.scannerMode === '1';
let activeBackupId = '';
let checkoutAlertUntil = 0;
const ADMIN_SESSION_KEY = 'admin_logged_in';
const adminAllowedScreens = new Set(['customer', 'cashier', 'backstore', 'system']);
const nonAdminAllowedScreens = new Set(['customer', 'cashier']);
let isAdminLoggedIn = sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
if (!isAdminLoggedIn && localStorage.getItem(ADMIN_SESSION_KEY) === '1') {
  // Migrate legacy persistent login to tab-session login for better safety.
  localStorage.removeItem(ADMIN_SESSION_KEY);
}
const tableParam = Number(new URLSearchParams(window.location.search).get('table') || 0);
const scannerAllowedScreens = new Set(['customer', 'cashier']);

async function loadNetworkBaseUrl() {
  const network = await api('/api/system/network');
  if (!network.error && network.base_url) {
    networkBaseUrl = window.location.origin;
    return;
  }
  if (!networkBaseUrl) {
    networkBaseUrl = window.location.origin;
  }
}

function resolveRuntimeHost() {
  return networkBaseUrl || window.location.origin;
}

function buildTableToken(table) {
  const tableId = Number(table?.id || 0);
  const suffix = String(table?.suffix || '');
  if (!tableId || suffix.length !== 4) return '';
  return `${tableId}${suffix}`;
}

function customerScanUrl(tableId) {
  const table = (db?.tables || []).find((item) => Number(item.id) === Number(tableId));
  const token = buildTableToken(table);
  if (token) return `${resolveRuntimeHost()}/customer?t=${encodeURIComponent(token)}`;
  return `${resolveRuntimeHost()}/customer?table=${tableId}`;
}
function buildQrImageUrl(text) { return window.PromptPayQR?.buildQrImageUrl(text) || ''; }
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

function playCheckoutAlertBurst(durationMs = 5000) {
  checkoutAlertUntil = Math.max(checkoutAlertUntil, Date.now() + durationMs);
  const tick = () => {
    if (Date.now() > checkoutAlertUntil) return;
    playAlert('checkout-request-sound');
    setTimeout(tick, 900);
  };
  tick();
}

function playCallStaffAlertBurst(durationMs = 5000) {
  checkoutAlertUntil = Math.max(checkoutAlertUntil, Date.now() + durationMs);
  const tick = () => {
    if (Date.now() > checkoutAlertUntil) return;
    playAlert('call-staff-sound');
    setTimeout(tick, 900);
  };
  tick();
}

async function api(path, options = {}) {
  const optionHeaders = options.headers || {};
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-POS-Role': 'owner', ...optionHeaders },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    return { error: 'invalid_json_response' };
  }
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
  const hostCheck = qs('system-host-check');
  if (serverStatus) {
    serverStatus.textContent = online ? 'Online' : 'Offline';
    serverStatus.classList.toggle('system-server-online', online);
    serverStatus.classList.toggle('system-server-offline', !online);
  }
  if (serverUtc) serverUtc.textContent = ping.server_time || '-';
  if (baseUrl) baseUrl.textContent = network.base_url || resolveRuntimeHost();
  if (lanIp) lanIp.textContent = network.local_ip || document.body.dataset.localIp || '-';
  if (hostCheck) hostCheck.textContent = network.is_host_request ? `ใช่ (${network.request_ip || '-'})` : `ไม่ใช่ (${network.request_ip || '-'})`;
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
  const allowedScreens = isAdminLoggedIn ? adminAllowedScreens : nonAdminAllowedScreens;
  if (!allowedScreens.has(id)) {
    if (id === 'backstore' || id === 'system') {
      openAdminLoginModal('เฉพาะ Admin เท่านั้นสำหรับเมนูนี้');
    }
    return;
  }
  if (scannerMode && !scannerAllowedScreens.has(id)) return;
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  qs(id).classList.remove('hidden');
  document.querySelectorAll('[data-screen]').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === id));
}


function applyRoleUI() {
  const tabBar = document.querySelector('.tab-bar');
  const tabButtons = [...document.querySelectorAll('[data-screen]')];

  const allowed = isAdminLoggedIn ? adminAllowedScreens : nonAdminAllowedScreens;
  tabButtons.forEach((button) => {
    const visible = allowed.has(button.dataset.screen);
    button.classList.toggle('hidden', !visible);
    button.setAttribute('aria-hidden', visible ? 'false' : 'true');
  });

  const loginBtn = qs('admin-login-btn');
  const logoutBtn = qs('admin-logout-btn');
  loginBtn?.classList.toggle('hidden', isAdminLoggedIn);
  logoutBtn?.classList.toggle('hidden', !isAdminLoggedIn);

  if (tabBar) tabBar.classList.remove('hidden');
}

function openAdminLoginModal(note = '') {
  if (scannerMode) return;
  qs('admin-login-pin').value = '';
  qs('admin-login-note').textContent = note;
  qs('admin-login-modal').classList.remove('hidden');
}

function closeAdminLoginModal() {
  qs('admin-login-modal').classList.add('hidden');
}

async function handleAdminLogin() {
  const enteredPin = qs('admin-login-pin').value.trim();
  const actualPin = String(db?.settings?.adminPin || '').trim();
  if (!enteredPin) {
    qs('admin-login-note').textContent = 'กรุณากรอกรหัส Admin';
    return;
  }
  if (!actualPin || enteredPin !== actualPin) {
    qs('admin-login-note').textContent = 'รหัสไม่ถูกต้อง';
    return;
  }
  isAdminLoggedIn = true;
  sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
  closeAdminLoginModal();
  applyRoleUI();
  showScreen('system');
}

function handleAdminLogout() {
  isAdminLoggedIn = false;
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  localStorage.removeItem(ADMIN_SESSION_KEY);
  applyRoleUI();
  showScreen('customer');
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
  ['admin-login-btn', 'admin-logout-btn', 'open-customer-display-from-header', 'open-staff-qr-modal']
    .forEach((id) => qs(id)?.classList.add('hidden'));
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
  return db.orders.filter((o) => o.target === 'table' && o.target_id === tableId && o.status !== 'cancelled');
}

function getTablePendingRequests(tableId) {
  return getTableOrders(tableId).filter((order) => order.source === 'customer' && order.status === 'request_pending');
}

function getTableAcceptedOrders(tableId) {
  return getTableOrders(tableId).filter((order) => order.status === 'accepted');
}

function getTableSummary(tableId, options = {}) {
  const acceptedOnly = options.acceptedOnly !== false;
  const orders = acceptedOnly ? getTableAcceptedOrders(tableId) : getTableOrders(tableId);
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
  playUISound();
}

function renderTables() {
  const grid = qs('table-grid');
  grid.innerHTML = '';
  db.tables.forEach((table) => {
    const tableOrders = getTableOrders(table.id);
    const pendingRequests = getTablePendingRequests(table.id);
    const hasAcceptedBefore = tableOrders.some((order) => order.status === 'accepted');
    const showAdditionalOrder = pendingRequests.length > 0 && hasAcceptedBefore;
    const displayStatus = table.call_staff_status === 'requested' ? 'checkout_requested' : table.status;
    const meta = statusMap[displayStatus] || statusMap.available;
    const { items, total } = getTableSummary(table.id, { acceptedOnly: true });
    const pendingItems = pendingRequests.flatMap((order) => order.items || []);
    const previewItems = items.length ? items : pendingItems;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `table-card ${meta.tone}`;
    card.dataset.tableId = String(table.id);
    if (table.call_staff_status === 'requested') card.classList.add('status-checkout_requested');
    const stackedItems = summarizeItems(previewItems);
    card.innerHTML = previewItems.length
      ? `<div class="table-head-row"><strong>${unitLabel()} ${table.id}</strong><span class="status-chip ${meta.tone}">${meta.icon}</span></div>
         <small>${stackedItems.slice(-4).map((i) => `${i.image ? '<img src=\"' + i.image + '\" alt=\"' + i.name + '\" class=\"table-item-thumb\" /> ' : ''}${i.name}${Number(i.qty || 1) > 1 ? ` x${Number(i.qty || 1)}` : ''} • ${money(i.price)}`).join('<br>')}</small>
         ${pendingRequests.length > 0 ? '<div class="dot-notify">🔔 มีคำขอรอยืนยัน</div>' : ''}
         ${showAdditionalOrder ? '<div class="dot-notify notify-additional">🆕 มีการสั่งเพิ่ม</div>' : ''}
         <div class="table-total">รวม ${money((items.length ? total : pendingItems.reduce((sum, item) => sum + (Number(item.price || 0) * Math.max(1, Number(item.qty || 1))), 0)))} บาท</div>`
      : `<div class="table-head-row"><strong>${unitLabel()} ${table.id}</strong><span class="status-chip available">○</span></div>
         <small>${pendingRequests.length > 0 ? '🔔 รอยืนยันคำขอ' : ''}</small>`;
    card.addEventListener('click', () => selectTable(table.id));
    grid.appendChild(card);
  });
}

function renderOrderMenuChoices() {
  const renderToken = ++orderMenuRenderToken;
  const grid = qs('order-menu-grid');
  grid.innerHTML = '';
  const filteredMenu = (db.menu || []).filter((item) => activeMenuCategory === 'ทั้งหมด' || (item.category || 'ทั่วไป') === activeMenuCategory);
  const batchSize = 60;
  let cursor = 0;
  const paintBatch = () => {
    if (renderToken !== orderMenuRenderToken) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(cursor + batchSize, filteredMenu.length);
    for (let index = cursor; index < end; index += 1) {
      const item = filteredMenu[index];
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
        activeOrderItemDraftQty = 1;
        qs('order-item-detail-title').textContent = item.name;
        qs('order-item-detail-qty-value').textContent = String(activeOrderItemDraftQty);
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
      fragment.appendChild(btn);
    }
    grid.appendChild(fragment);
    cursor = end;
    if (cursor < filteredMenu.length) window.requestAnimationFrame(paintBatch);
  };
  window.requestAnimationFrame(paintBatch);
  if (!filteredMenu.length) {
    grid.innerHTML = '<div class="empty">ไม่มีเมนูในหมวดนี้</div>';
  }
}

function getMenuCategories() {
  const categories = new Set(['ทั้งหมด']);
  getMenuCategoryChoices().forEach((name) => categories.add(name));
  return [...categories];
}

function normalizeCategoryName(value, fallback = 'ทั่วไป') {
  const cleaned = String(value || '').trim();
  return cleaned || fallback;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

async function optimizeImageFile(file, options = {}) {
  if (!(file instanceof File)) return '';
  const {
    maxWidth = 720,
    maxHeight = 720,
    quality = 0.76,
    crop = 'none',
    mimeType = 'image/webp',
  } = options;
  const source = await readFileAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_decode_failed'));
    img.src = source;
  });
  const canvas = document.createElement('canvas');
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  if (crop === 'square') {
    const side = Math.min(image.width, image.height);
    sourceX = Math.floor((image.width - side) / 2);
    sourceY = Math.floor((image.height - side) / 2);
    sourceWidth = side;
    sourceHeight = side;
  }
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
  canvas.width = Math.max(1, Math.round(sourceWidth * ratio));
  canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(mimeType, quality);
}

function getMenuCategoryChoices() {
  const categories = new Set(DEFAULT_MENU_CATEGORIES);
  const customCategories = Array.isArray(db?.settings?.menuCategories) ? db.settings.menuCategories : [];
  customCategories.forEach((name) => {
    const clean = normalizeCategoryName(name, '');
    if (clean) categories.add(clean);
  });
  (db?.menu || []).forEach((item) => {
    const name = normalizeCategoryName(item.category, '');
    if (name) categories.add(name);
  });
  return [...categories];
}

function renderMenuCategorySelect(selected = 'ทั่วไป') {
  const select = qs('menu-category');
  if (!select) return;
  const categories = getMenuCategoryChoices();
  const safeSelected = categories.includes(selected) ? selected : 'ทั่วไป';
  select.innerHTML = categories.map((name) => `<option value="${name}">${name}</option>`).join('');
  select.value = safeSelected;
}

function renderMenuCategoryAdmin() {
  const wrap = qs('menu-category-admin');
  if (!wrap) return;
  const categories = getMenuCategories().filter((name) => name !== 'ทั้งหมด');
  if (!categories.length) {
    wrap.innerHTML = '<div class="list-card">ยังไม่มีหมวด</div>';
    return;
  }
  wrap.innerHTML = '';
  wrap.classList.add('menu-category-admin-tabs');
  categories.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'list-card menu-category-tab-card';
    const isDefault = cat === 'ทั่วไป';
    row.innerHTML = `<button class="subtab menu-category-pill" type="button"># ${cat} (${countItemsByCategory(cat)})</button><div class="btn-row"><button data-a="rename" class="btn-soft" type="button">✏️</button><button data-a="delete" class="btn-soft ${isDefault ? 'hidden' : ''}" type="button">🗑️</button></div>`;
    row.querySelector('.menu-category-pill')?.addEventListener('click', () => {
      activeMenuCategory = cat;
      renderOrderCategoryTabs();
      renderOrderMenuChoices();
    });
    row.querySelector('[data-a="rename"]')?.addEventListener('click', () => renameMenuCategory(cat));
    row.querySelector('[data-a="delete"]')?.addEventListener('click', () => deleteMenuCategory(cat));
    wrap.appendChild(row);
  });
}

function countItemsByCategory(category) {
  if (category === 'ทั้งหมด') return (db?.menu || []).length;
  return (db?.menu || []).filter((item) => normalizeCategoryName(item.category) === category).length;
}

async function persistMenuCategories(categoryList = []) {
  const normalized = [...new Set(categoryList.map((name) => normalizeCategoryName(name, '')).filter(Boolean))];
  const customOnly = normalized.filter((name) => !DEFAULT_MENU_CATEGORIES.includes(name));
  db.settings = db.settings || {};
  db.settings.menuCategories = customOnly;
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: { menuCategories: customOnly }, menu: db.menu || [] }) });
}

async function renameMenuCategory(sourceCategory) {
  const from = normalizeCategoryName(sourceCategory);
  const next = normalizeCategoryName(window.prompt(`เปลี่ยนชื่อหมวด "${from}" เป็น`, from), '');
  if (!next || next === from) return;
  const exists = getMenuCategoryChoices().some((name) => name === next);
  if (exists) {
    window.alert('มีหมวดนี้อยู่แล้ว');
    return;
  }
  db.menu = (db.menu || []).map((item) => (normalizeCategoryName(item.category) === from ? { ...item, category: next } : item));
  const currentCategories = getMenuCategoryChoices().filter((name) => name !== from);
  await persistMenuCategories([...currentCategories, next]);
  await loadData();
}

async function deleteMenuCategory(sourceCategory) {
  const target = normalizeCategoryName(sourceCategory);
  if (target === 'ทั่วไป') return;
  const ok = window.confirm(`ลบหมวด "${target}" และย้ายเมนูไปหมวด "ทั่วไป" ?`);
  if (!ok) return;
  db.menu = (db.menu || []).map((item) => (normalizeCategoryName(item.category) === target ? { ...item, category: 'ทั่วไป' } : item));
  const remainingCategories = getMenuCategoryChoices().filter((name) => !['ทั่วไป', target].includes(name));
  await persistMenuCategories(remainingCategories);
  await loadData();
}

async function addMenuCategory() {
  const input = qs('menu-category-name');
  if (!input) return;
  const name = normalizeCategoryName(input.value, '');
  if (!name) return;
  if (getMenuCategoryChoices().includes(name)) {
    window.alert('หมวดนี้มีอยู่แล้ว');
    return;
  }
  await persistMenuCategories([...getMenuCategoryChoices(), name]);
  input.value = '';
  await loadData();
}

function renderOrderCategoryTabs() {
  const wrap = qs('order-menu-category-tabs');
  if (!wrap) return;
  const categories = getMenuCategories();
  if (!categories.includes(activeMenuCategory)) activeMenuCategory = 'ทั้งหมด';
  wrap.innerHTML = '';
  categories.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `subtab ${cat === activeMenuCategory ? 'is-active' : ''}`;
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      activeMenuCategory = cat;
      renderOrderCategoryTabs();
      renderOrderMenuChoices();
    });
    wrap.appendChild(btn);
  });
}

function renderOrderCart() {
  const list = qs('order-cart-list');
  list.innerHTML = '';
  if (!orderCart.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการในตะกร้า</div>';
    qs('order-cart-total').textContent = 'รวม 0 บาท';
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

function formatElapsedMinutes(value) {
  if (!value) return '-';
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp) || stamp <= 0) return '-';
  const minutes = Math.max(1, Math.floor((Date.now() - stamp) / 60000));
  return `${minutes} นาที`;
}

function renderExistingOrders(tableId) {
  const list = qs('order-existing-list');
  const totalNode = qs('order-existing-total');
  if (!list || !totalNode) return;
  list.innerHTML = '';
  const orders = getTableAcceptedOrders(tableId);
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
  totalNode.textContent = `ยอดรวมตอนนี้ ${money(total)} บาท`;
}

function renderPendingRequestActions(tableId) {
  const list = qs('order-request-list');
  if (!list) return;
  const pendingRequests = getTablePendingRequests(tableId)
    .slice()
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  list.innerHTML = '';
  if (!pendingRequests.length) {
    list.innerHTML = '<div class="empty">ไม่มีคำขอค้างจากลูกค้า</div>';
    return;
  }
  pendingRequests.forEach((requestOrder) => {
    const row = document.createElement('div');
    row.className = 'list-card';
    const orderItems = summarizeItems(requestOrder.items || []);
    const itemText = orderItems.length
      ? orderItems.map((item) => `${item.name}${Math.max(1, Number(item.qty || 1)) > 1 ? ` x${Math.max(1, Number(item.qty || 1))}` : ''}`).join(', ')
      : 'ไม่มีรายการ';
    const inFlight = requestActionInFlight.has(requestOrder.id);
    row.innerHTML = `
      <strong>คำขอ #${requestOrder.id}</strong>
      <div class="muted">${itemText}</div>
      <div class="btn-row">
        <button class="btn-primary js-accept-request" data-order-id="${requestOrder.id}" ${inFlight ? 'disabled' : ''} title="รับคำขอ">✅</button>
        <button class="btn-soft js-reject-request" data-order-id="${requestOrder.id}" ${inFlight ? 'disabled' : ''} title="ปฏิเสธ">❌</button>
      </div>`;
    list.appendChild(row);
  });
}

async function handlePendingRequestAction(orderId, action) {
  if (!orderId || requestActionInFlight.has(orderId)) return;
  requestActionInFlight.add(orderId);
  renderPendingRequestActions(selectedTableId);
  const endpoint = action === 'accept' ? '/api/table/accept' : '/api/table/reject';
  try {
    const res = await api(endpoint, { method: 'POST', body: JSON.stringify({ order_id: orderId }) });
    if (res.error) return;
    if (action === 'accept') qs('table-order-modal')?.classList.add('hidden');
    await loadData();
  } finally {
    requestActionInFlight.delete(orderId);
    renderPendingRequestActions(selectedTableId);
  }
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
    totalNode.textContent = 'รวม 0 บาท';
    if (acceptBtn) acceptBtn.disabled = true;
    return;
  }

  const table = db.tables.find((t) => t.id === selectedTableId);
  const meta = statusMap[table?.status] || statusMap.available;
  const { items, total } = getTableSummary(selectedTableId, { acceptedOnly: true });
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
  const pendingRequests = getTablePendingRequests(selectedTableId);
  const hasCustomerNewOrder = pendingRequests.length > 0;
  if (acceptBtn) {
    acceptBtn.disabled = !hasCustomerNewOrder || acceptRequestInFlight;
    if (acceptRequestInFlight) {
      acceptBtn.textContent = '⏳ กำลังรับทราบคำขอ...';
    } else if (hasCustomerNewOrder) {
      acceptBtn.textContent = `✅ รับทราบคำขอใหม่ (${pendingRequests.length})`;
    } else {
      acceptBtn.textContent = '✅ ไม่มีคำขอค้าง';
    }
  }
}

function selectTable(tableId) {
  selectedTableId = tableId;
  orderCart = [];
  const table = db.tables.find((t) => t.id === tableId);
  const meta = statusMap[table?.status] || statusMap.available;
  qs('order-meta-table').textContent = `${unitLabel()} ${tableId}`;
  qs('order-meta-status').textContent = `สถานะ: ${meta.label}`;
  renderOrderCategoryTabs();
  renderOrderMenuChoices();
  renderOrderCart();
  renderExistingOrders(tableId);
  renderPendingRequestActions(tableId);
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
    const qty = Math.max(1, Number(item.qty || 1));
    row.innerHTML = `
      <div class="bill-item-main">
        <strong>${item.name}${qty > 1 ? ` x${qty}` : ''}</strong>
        ${item.addon ? `<small>${item.addon}</small>` : ''}
      </div>
      <div class="bill-item-side">
        <span>฿${money(Number(item.price || 0) * qty)}</span>
      </div>
    `;
    if (isAdminLoggedIn) {
      const actions = document.createElement('div');
      actions.className = 'bill-item-actions';
      actions.innerHTML = `
        <button class="btn-soft btn-danger icon-delete" type="button" data-action="delete" aria-label="ลบรายการ">✕</button>
      `;
      actions.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteBillItem(item));
      row.appendChild(actions);
    }
    qs('bill-items').appendChild(row);
  });
  if (!isAdminLoggedIn && bill.items.length) {
    const lockNote = document.createElement('div');
    lockNote.className = 'muted';
    lockNote.textContent = 'การลบรายการเช็คบิล จำกัดเฉพาะ Admin บนเครื่องแม่';
    qs('bill-items').appendChild(lockNote);
  }
  qs('bill-total').textContent = money(bill.total);
  const paymentImage = resolvePaymentQrImage(db.settings, Number(bill.total || 0));
  setPaymentQrDisplay(paymentImage);
  qs('payment-modal').classList.remove('hidden');
}

function requireBillAdminAction() {
  if (isAdminLoggedIn) return true;
  window.alert('เฉพาะ Admin เท่านั้นที่แก้ไข/ลบรายการเช็คบิลได้');
  return false;
}

async function deleteBillItem(item) {
  if (!requireBillAdminAction() || !item?.order_id) return;
  const ok = window.confirm(`ยืนยันลบ "${item.name}" ออกจากบิล?`);
  if (!ok) return;
  const res = await api('/api/order/item', {
    method: 'DELETE',
    body: JSON.stringify({
      order_id: item.order_id,
      item_index: Number(item.item_index),
    }),
  });
  if (res.error) {
    window.alert(`ลบไม่สำเร็จ: ${res.error}`);
    return;
  }
  await loadData();
  await openBill(activeCashierTableId);
}

function openCustomerDisplayWindow(tableId) {
  const nextTableId = Number(tableId || 0);
  localStorage.setItem(CUSTOMER_DISPLAY_ACTIVE_TABLE_KEY, String(nextTableId > 0 ? nextTableId : 0));
  syncCustomerDisplayActiveTable(nextTableId > 0 ? nextTableId : 0);
  const popup = window.open(nextTableId > 0 ? `/customer-display?table=${encodeURIComponent(nextTableId)}` : '/customer-display', 'customer-bill-display');
  if (popup) popup.focus();
}

async function syncCustomerDisplayActiveTable(tableId) {
  await api('/api/customer-display/active', {
    method: 'POST',
    body: JSON.stringify({ table_id: Number(tableId || 0) }),
  });
}

function buildPromptPayPayload(promptPayId, amount = 0, dynamic = true) {
  return window.PromptPayQR?.buildPromptPayPayload(promptPayId, amount, dynamic) || '';
}

function buildPromptPayQrImage(promptPayId, amount, dynamic) {
  const payload = buildPromptPayPayload(promptPayId, amount, dynamic);
  if (!payload) return '';
  return buildQrImageUrl(payload);
}

function resolvePaymentQrImage(settings, totalAmount) {
  const cfg = settings || {};
  const promptPayId = String(cfg.promptPay || '').trim();
  const hasUploadedQrImage = Boolean(String(cfg.qrImage || '').trim());
  if (cfg.dynamicPromptPay && promptPayId) {
    return buildPromptPayQrImage(cfg.promptPay || '', Number(totalAmount || 0), true);
  }
  if (hasUploadedQrImage) return cfg.qrImage;
  return buildPromptPayQrImage(promptPayId, Number(totalAmount || 0), false);
}

function setPaymentQrDisplay(imageUrl) {
  const wrap = qs('bill-payment-qr-wrap');
  const image = qs('bill-payment-qr-image');
  const note = qs('bill-payment-qr-note');
  const safeImageUrl = String(imageUrl || '').trim();
  if (!safeImageUrl) {
    image?.removeAttribute('src');
    wrap?.classList.add('hidden');
    if (note) {
      note.textContent = 'ไม่มี QR สำหรับรับชำระ (ยังไม่ได้ตั้งค่าพร้อมเพย์หรืออัปโหลดรูป QR)';
      note.classList.remove('hidden');
    }
    return;
  }
  image.src = safeImageUrl;
  wrap?.classList.remove('hidden');
  if (note) {
    note.textContent = '';
    note.classList.add('hidden');
  }
}

function renderCashier() {
  const wrap = qs('checkout-list');
  wrap.innerHTML = '';
  const queues = db.tables.filter((t) => getTableOrders(t.id).some((o) => o.status === 'accepted'));
  qs('checkout-count').textContent = `${queues.length} รายการ`;
  if (!queues.length) {
    wrap.innerHTML = '<div class="empty">ยังไม่มีคิวใช้งาน</div>';
    return;
  }
  queues.forEach((table) => {
    const meta = statusMap[table.status] || statusMap.available;
    const tableOrders = getTableAcceptedOrders(table.id);
    const { items, total } = getTableSummary(table.id, { acceptedOnly: true });
    const groupedItems = summarizeItems(items);
    const orderTimes = tableOrders
      .map((order) => new Date(order.created_at || order.updated_at || 0).getTime())
      .filter((stamp) => Number.isFinite(stamp) && stamp > 0)
      .sort((a, b) => b - a);
    const openedAt = orderTimes.length ? orderTimes[orderTimes.length - 1] : 0;
    const row = document.createElement('button');
    row.className = `list-card checkout-card ${meta.tone}`;
    row.innerHTML = `<strong class="checkout-title">${meta.icon} ${unitLabel()} ${table.id}</strong>
      <small>${table.status === 'available' ? '' : meta.label}</small>
      <div class="checkout-meta-row">
        <span class="pill">⏱️ ใช้โต๊ะ ${formatElapsedMinutes(openedAt)}</span>
      </div>
      <div class="checkout-items">${groupedItems.length ? groupedItems.slice(-5).map((i) => {
    const qty = Math.max(1, Number(i.qty || 1));
    const thumb = i.image ? `<img src="${i.image}" alt="${i.name}" class="checkout-item-thumb" />` : '<span class="checkout-item-thumb fallback">🍽️</span>';
    return `<div class="checkout-item-row">${thumb}<span>${i.name}${qty > 1 ? ` x${qty}` : ''}</span></div>`;
  }).join('') : ''}</div>
      <strong>รวม ${money(total)} บาท</strong>`;
    row.addEventListener('click', () => {
      localStorage.setItem(CUSTOMER_DISPLAY_ACTIVE_TABLE_KEY, String(table.id));
      syncCustomerDisplayActiveTable(table.id);
      openBill(table.id);
    });
    wrap.appendChild(row);
  });
  wrap.dataset.gridSize = queues.length > 9 ? '4' : '3';
}

function renderMenu() {
  const list = qs('menu-list');
  list.innerHTML = '';
  renderBackstoreMenuCategoryTabs();
  const filteredMenu = (db.menu || []).filter((item) => activeBackstoreMenuCategory === 'ทั้งหมด' || normalizeCategoryName(item.category) === activeBackstoreMenuCategory);
  filteredMenu.forEach((item) => {
    const idx = (db.menu || []).findIndex((entry) => entry.id === item.id);
    const row = document.createElement('div');
    row.className = 'list-card menu-admin-row';
    row.innerHTML = `<div class="menu-admin-meta"><div class="menu-thumb menu-admin-thumb">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : 'IMG'}</div><div class="menu-admin-copy"><strong>${item.name}</strong><small>${normalizeCategoryName(item.category)} • ${money(item.price)} บาท</small></div></div><div class="btn-row"><button data-a="e" class="btn-soft">แก้ไข</button><button data-a="d" class="btn-soft">ลบ</button></div>`;
    row.querySelector('[data-a="e"]').addEventListener('click', () => openEditMenuModal(item));
    row.querySelector('[data-a="d"]').addEventListener('click', async () => { db.menu.splice(idx, 1); await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) }); await loadData(); });
    list.appendChild(row);
  });
  if (!filteredMenu.length) list.innerHTML = '<div class="empty">ไม่มีเมนูในหมวดที่เลือก</div>';
  renderMenuCategoryAdmin();
}

function renderBackstoreMenuCategoryTabs() {
  const tabWrap = qs('menu-category-filter-tabs');
  if (!tabWrap) return;
  const categories = getMenuCategories();
  if (!categories.includes(activeBackstoreMenuCategory)) activeBackstoreMenuCategory = 'ทั้งหมด';
  tabWrap.innerHTML = '';
  categories.forEach((category) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `subtab ${activeBackstoreMenuCategory === category ? 'is-active' : ''}`;
    btn.textContent = `${category} (${countItemsByCategory(category)})`;
    btn.addEventListener('click', () => {
      activeBackstoreMenuCategory = category;
      renderMenu();
    });
    tabWrap.appendChild(btn);
  });
}

function resetMenuModal() {
  editingMenuId = null;
  qs('menu-modal').querySelector('h3').textContent = 'Add Menu';
  qs('menu-name').value = '';
  qs('menu-price').value = '';
  qs('addon-rows').innerHTML = '';
  qs('menu-image-file').value = '';
  renderMenuCategorySelect('ทั่วไป');
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
  renderMenuCategorySelect(item.category || 'ทั่วไป');
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
    return { start, end, previousStart: new Date(start.getTime() - (24 * 60 * 60 * 1000)), previousEnd: new Date(end.getTime() - (24 * 60 * 60 * 1000)), label: 'วันนี้' };
  }
  if (period === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime() + (7 * 24 * 60 * 60 * 1000) - 1);
    return { start, end, previousStart: new Date(start.getTime() - (7 * 24 * 60 * 60 * 1000)), previousEnd: new Date(end.getTime() - (7 * 24 * 60 * 60 * 1000)), label: 'สัปดาห์นี้' };
  }
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  end.setMonth(start.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  const previousStart = new Date(start);
  previousStart.setMonth(previousStart.getMonth() - 1);
  const previousEnd = new Date(start.getTime() - 1);
  return { start, end, previousStart, previousEnd, label: 'เดือนนี้' };
}

function toStartOfHour(value) {
  const date = new Date(value);
  date.setMinutes(0, 0, 0);
  return date;
}

function formatBucketLabel(date, granularity) {
  if (granularity === 'hour') return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (granularity === 'month') return date.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
  return date.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
}

function chooseChartGranularity(range) {
  const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime() + 1) / (24 * 60 * 60 * 1000)));
  if (days <= 2) return 'hour';
  if (days <= 45) return 'day';
  return 'month';
}

function buildSalesBuckets(range, sales, granularity) {
  const bucketMap = new Map();
  const cursor = new Date(range.start);
  if (granularity === 'hour') {
    cursor.setMinutes(0, 0, 0);
    while (cursor <= range.end) {
      const key = cursor.toISOString();
      bucketMap.set(key, { key, label: formatBucketLabel(cursor, 'hour'), value: 0 });
      cursor.setHours(cursor.getHours() + 1);
    }
  } else if (granularity === 'month') {
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= range.end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      bucketMap.set(key, { key, label: formatBucketLabel(cursor, 'month'), value: 0 });
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }
  } else {
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= range.end) {
      const key = cursor.toISOString().slice(0, 10);
      bucketMap.set(key, { key, label: formatBucketLabel(cursor, 'day'), value: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  sales.forEach((sale) => {
    const saleTime = salesDate(sale);
    let key = '';
    if (granularity === 'hour') key = toStartOfHour(saleTime).toISOString();
    else if (granularity === 'month') key = `${saleTime.getFullYear()}-${String(saleTime.getMonth() + 1).padStart(2, '0')}`;
    else key = saleTime.toISOString().slice(0, 10);
    const point = bucketMap.get(key);
    if (point) point.value += Number(sale.total || 0);
  });
  return [...bucketMap.values()];
}

function renderSalesChart(points = [], chart = qs('sales-chart')) {
  if (!chart) return;
  if (!points.length || points.every((point) => point.value <= 0)) {
    chart.innerHTML = '<div class="empty">ยังไม่มียอดขายในช่วงนี้ • ระบบจะแสดงกราฟทันทีเมื่อมีรายการใหม่</div>';
    return;
  }
  const width = 720;
  const height = 240;
  const padding = { top: 20, right: 16, bottom: 42, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...points.map((point) => point.value));
  const coords = points.map((point, index) => {
    const ratio = points.length > 1 ? index / (points.length - 1) : 0.5;
    const x = padding.left + (plotWidth * ratio);
    const y = padding.top + (plotHeight - ((point.value / maxValue) * plotHeight));
    return { ...point, x, y };
  });
  const linePath = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${(padding.top + plotHeight).toFixed(2)} L ${coords[0].x.toFixed(2)} ${(padding.top + plotHeight).toFixed(2)} Z`;
  const yTicks = Array.from({ length: 4 }, (_, idx) => {
    const value = maxValue * (idx / 3);
    const y = padding.top + plotHeight - ((value / maxValue) * plotHeight);
    return { value, y };
  });
  const labelStep = points.length > 10 ? Math.ceil(points.length / 6) : 1;
  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="sales-chart-svg" role="img" aria-label="กราฟแนวโน้มยอดขาย">
      <defs>
        <linearGradient id="salesAreaGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"></stop>
          <stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"></stop>
        </linearGradient>
      </defs>
      ${yTicks.map((tick) => `<line x1="${padding.left}" y1="${tick.y.toFixed(2)}" x2="${(padding.left + plotWidth).toFixed(2)}" y2="${tick.y.toFixed(2)}" class="sales-chart-grid"></line><text x="6" y="${(tick.y + 4).toFixed(2)}" class="sales-chart-y">${money(tick.value)}</text>`).join('')}
      <path d="${areaPath}" fill="url(#salesAreaGradient)"></path>
      <path d="${linePath}" class="sales-chart-line"></path>
      ${coords.map((point) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5" class="sales-chart-dot"></circle>`).join('')}
      ${coords.filter((_, index) => index % labelStep === 0 || index === coords.length - 1).map((point) => `<text x="${point.x.toFixed(2)}" y="${(height - 16).toFixed(2)}" text-anchor="middle" class="sales-chart-x">${point.label}</text>`).join('')}
    </svg>
  `;
}

function summarizeBestMenuFromSales(sales = [], limit = 5) {
  const itemMap = new Map();
  sales.forEach((sale) => {
    summarizeItems(sale.items || []).forEach((item) => {
      const key = String(item.name || '').trim();
      if (!key) return;
      itemMap.set(key, (itemMap.get(key) || 0) + Number(item.qty || 1));
    });
  });
  return [...itemMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, qty]) => ({ name, qty }));
}

function openSalesPeriodModal(range, salesInRange) {
  const modal = qs('sales-period-modal');
  const title = qs('sales-period-modal-title');
  const content = qs('sales-period-modal-content');
  if (!modal || !title || !content) return;
  const total = salesInRange.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const cashTotal = salesInRange
    .filter((sale) => sale.payment_method === 'cash')
    .reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const qrTotal = salesInRange
    .filter((sale) => sale.payment_method === 'qr')
    .reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const granularity = chooseChartGranularity(range);
  const points = buildSalesBuckets(range, salesInRange, granularity);
  const bestItems = summarizeBestMenuFromSales(salesInRange, 6);
  const historyRows = salesInRange
    .slice()
    .sort((a, b) => salesDate(b) - salesDate(a))
    .slice(0, 12)
    .map((sale) => {
      const paidText = new Date(sale.paid_at || sale.timestamp || Date.now()).toLocaleString('th-TH');
      return `<li><strong>${unitLabel()} ${sale.target_id}</strong><span>฿${money(sale.total)} • ${paidText}</span></li>`;
    })
    .join('');
  title.textContent = `เปรียบเทียบยอดขาย • ${range.label}`;
  content.innerHTML = `
    <div class="sales-overview-grid">
      <div class="list-card sales-kpi total"><strong>🧾 ยอดรวม</strong><div>฿${money(total)}</div></div>
      <div class="list-card sales-kpi"><strong>💵 เงินสด</strong><div>฿${money(cashTotal)}</div></div>
      <div class="list-card sales-kpi"><strong>📱 โอน/QR</strong><div>฿${money(qrTotal)}</div></div>
      <div class="list-card sales-kpi"><strong>จำนวนบิล</strong><div>${salesInRange.length}</div></div>
    </div>
    <div id="sales-period-modal-chart" class="sales-chart"></div>
    <div class="sales-modal-grid">
      <section class="list-card">
        <h4>🧾 ประวัติในช่วงนี้</h4>
        <ul class="sales-modal-list">${historyRows || '<li>ยังไม่มีบิลในช่วงนี้</li>'}</ul>
      </section>
      <section class="list-card">
        <h4>🔥 เมนูขายดีในช่วงนี้</h4>
        <ul class="sales-modal-list">${bestItems.length ? bestItems.map((item) => `<li><strong>${item.name}</strong><span>x${item.qty}</span></li>`).join('') : '<li>ยังไม่มีรายการขาย</li>'}</ul>
      </section>
    </div>
  `;
  renderSalesChart(points, qs('sales-period-modal-chart'));
  modal.classList.remove('hidden');
}

function renderSales() {
  const sales = db.sales || [];
  const range = salesFilterRange || periodRange(salesPeriod, new Date());
  const inCurrent = sales.filter((s) => salesDate(s) >= range.start && salesDate(s) <= range.end);
  const inPrevious = sales.filter((s) => salesDate(s) >= range.previousStart && salesDate(s) <= range.previousEnd);
  const currentTotal = inCurrent.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const previousTotal = inPrevious.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const cash = inCurrent.filter((s) => s.payment_method === 'cash').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const qr = inCurrent.filter((s) => s.payment_method === 'qr').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const delta = currentTotal - previousTotal;
  const deltaPercent = previousTotal > 0 ? ((delta / previousTotal) * 100) : 0;
  const comparisonText = previousTotal > 0
    ? `${delta >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${money(Math.abs(delta))} บาท (${Math.abs(deltaPercent).toFixed(1)}%) เทียบช่วงก่อนหน้า`
    : 'ไม่มีข้อมูลช่วงก่อนหน้าให้เทียบ';
  const comparison = qs('sales-comparison');
  if (comparison) {
    comparison.className = `sales-comparison-card ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : 'is-flat'}`;
    comparison.innerHTML = `<strong>${range.label}</strong><span>${comparisonText}</span>`;
  }
  qs('sales-overview').innerHTML = `<div class="list-card sales-kpi"><strong>💵 เงินสด</strong><div>฿${money(cash)}</div></div><div class="list-card sales-kpi"><strong>📱 QR</strong><div>฿${money(qr)}</div></div><div class="list-card sales-kpi total"><strong>🧾 ยอดรวม</strong><div>฿${money(currentTotal)}</div></div><div class="list-card sales-kpi"><strong>จำนวนบิล</strong><div>${inCurrent.length}</div></div>`;
  const granularity = salesFilterRange ? chooseChartGranularity(range) : (salesPeriod === 'day' ? 'hour' : salesPeriod === 'week' ? 'day' : 'day');
  const points = buildSalesBuckets(range, inCurrent, granularity);
  renderSalesChart(points);
  const body = qs('sales-list');
  body.innerHTML = '';
  if (!inCurrent.length) {
    body.innerHTML = `<div class="empty">ยังไม่มียอดขายใน${range.label} • ลองเปลี่ยนช่วงเป็น วัน/สัปดาห์/เดือน หรือเลือกวันที่ใหม่</div>`;
  }
  inCurrent.slice().sort((a, b) => salesDate(b) - salesDate(a)).forEach((sale) => {
    const isCash = sale.payment_method === 'cash';
    const groupedItems = summarizeItems(sale.items || []).slice(0, 6);
    const card = document.createElement('article');
    card.className = 'list-card sales-row-card';
    card.innerHTML = `<div class="sales-row-head"><strong>${unitLabel()} ${sale.target_id}</strong><strong>฿${money(sale.total)}</strong></div>
      <small>🕒 ${new Date(sale.paid_at || Date.now()).toLocaleString('th-TH')}</small>
      <div class="sales-order-items">${groupedItems.length ? groupedItems.map((item) => `<span class="sales-order-chip">${item.name}${Number(item.qty || 1) > 1 ? ` x${Number(item.qty || 1)}` : ''}</span>`).join('') : '<span class="sales-order-chip">ไม่มีรายการ</span>'}</div>
      <div class="sales-row-foot"><span class="sales-pay-icon">${isCash ? '💵' : '📱'}</span><small>${isCash ? 'เงินสด' : 'โอน'}</small><button class="btn-soft btn-danger js-sales-delete" data-sale-id="${sale.id}" type="button" aria-label="ลบประวัติ">🗑️</button></div>`;
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
  renderPaymentReadiness();
  renderBackupList();
}

function renderPaymentReadiness() {
  const wrap = qs('payment-readiness');
  if (!wrap) return;
  const settings = db.settings || {};
  const hasPromptPay = Boolean(String(settings.promptPay || '').trim());
  const hasQrImage = Boolean(String(settings.qrImage || '').trim());
  const onlineReady = navigator.onLine && Boolean(resolveRuntimeHost());
  const dynamicEnabled = Boolean(settings.dynamicPromptPay);

  const rows = [
    { label: 'พร้อมเพย์ถูกตั้งค่า', ok: hasPromptPay, okText: 'พร้อม', warnText: 'ยังไม่กรอกหมายเลขพร้อมเพย์' },
    {
      label: 'อัปโหลดรูป QR พร้อมเพย์ (โหมด Static)',
      ok: dynamicEnabled ? true : hasQrImage,
      okText: dynamicEnabled ? 'ไม่จำเป็นเมื่อใช้ Dynamic' : 'มีไฟล์แล้ว',
      warnText: 'ยังไม่อัปโหลดรูป',
    },
    { label: 'สแกนแบบมีเน็ต', ok: onlineReady, okText: 'ออนไลน์', warnText: 'ออฟไลน์ (ตรวจเน็ตอีกครั้ง)' },
    { label: 'Dynamic PromptPay', ok: dynamicEnabled, okText: 'เปิดใช้งาน', warnText: 'ปิดใช้งาน' },
  ];
  wrap.innerHTML = rows
    .map((row) => `<div class="payment-readiness-item"><span>${row.label}</span><strong class="${row.ok ? 'payment-ok' : 'payment-warn'}">${row.ok ? `✅ ${row.okText}` : `⚠️ ${row.warnText}`}</strong></div>`)
    .join('');
}

function readLocalBackups() {
  try {
    const raw = localStorage.getItem(BACKUP_SNAPSHOTS_KEY);
    const data = JSON.parse(raw || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((row) => row && typeof row === 'object' && row.id && row.payload && row.created_at);
  } catch (error) {
    return [];
  }
}

function writeLocalBackups(rows) {
  localStorage.setItem(BACKUP_SNAPSHOTS_KEY, JSON.stringify(rows.slice(0, 20)));
}

function pushLocalBackup(snapshotDb) {
  const now = new Date();
  const backups = readLocalBackups();
  const source = snapshotDb?.__source === 'before_restore' ? 'before_restore' : 'local';
  const payload = source === 'before_restore'
    ? { ...snapshotDb, __source: undefined }
    : snapshotDb;
  backups.unshift({
    id: `${now.getTime()}-${Math.random().toString(16).slice(2, 7)}`,
    created_at: now.toISOString(),
    store_name: snapshotDb?.settings?.storeName || 'FAKDU',
    table_count: Number(snapshotDb?.tableCount || 0),
    sales_count: Array.isArray(snapshotDb?.sales) ? snapshotDb.sales.length : 0,
    source,
    payload,
  });
  writeLocalBackups(backups);
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderBackupList() {
  const wrap = qs('backup-history-list');
  if (!wrap) return;
  const backups = readLocalBackups();
  if (!backups.length) {
    wrap.innerHTML = '<div class="empty">ยังไม่มี Backup ในเครื่องนี้</div>';
    return;
  }
  wrap.innerHTML = '';
  backups.forEach((row) => {
    const card = document.createElement('div');
    card.className = 'list-card backup-row';
    const stamp = new Date(row.created_at || Date.now()).toLocaleString('th-TH');
    const sourceTag = row.source === 'before_restore' ? '🛟 ก่อนกู้คืน' : '🖥️ ภายในเครื่อง';
    card.innerHTML = `<div><strong>${row.store_name || 'FAKDU'}</strong><small>${stamp} • โต๊ะ ${row.table_count || 0} • บิล ${row.sales_count || 0}</small></div>
      <span class="backup-source">${sourceTag}</span>
      <div class="btn-row">
        <button class="btn-soft js-backup-manage" data-id="${row.id}" type="button">จัดการไฟล์</button>
      </div>`;
    wrap.appendChild(card);
  });
}

function deleteLocalBackup(backupId) {
  const nextRows = readLocalBackups().filter((row) => row.id !== backupId);
  writeLocalBackups(nextRows);
}

function openBackupActionModal(backup) {
  if (!backup) return;
  activeBackupId = backup.id;
  const stamp = new Date(backup.created_at || Date.now()).toLocaleString('th-TH');
  qs('backup-action-summary').innerHTML = `
    <strong>${backup.store_name || 'FAKDU'}</strong>
    <small>${stamp} • โต๊ะ ${backup.table_count || 0} • บิล ${backup.sales_count || 0}</small>
  `;
  qs('backup-action-modal').classList.remove('hidden');
}

function closeBackupActionModal() {
  activeBackupId = '';
  qs('backup-action-modal').classList.add('hidden');
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
  renderOrderCategoryTabs();
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
  document.querySelectorAll('[data-backup-tab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-backup-tab]').forEach((node) => node.classList.toggle('is-active', node === btn));
    ['history', 'import'].forEach((name) => qs(`backup-tab-${name}`)?.classList.toggle('hidden', name !== btn.dataset.backupTab));
  }));

  qs('close-qr-modal').addEventListener('click', () => qs('qr-modal').classList.add('hidden'));
  qs('close-backup-action-modal')?.addEventListener('click', closeBackupActionModal);
  qs('backup-action-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'backup-action-modal') closeBackupActionModal();
  });
  qs('close-forgot-admin-modal').addEventListener('click', () => qs('forgot-admin-modal').classList.add('hidden'));
  qs('admin-login-btn')?.addEventListener('click', () => openAdminLoginModal(''));
  qs('admin-logout-btn')?.addEventListener('click', () => handleAdminLogout());
  qs('close-admin-login-modal')?.addEventListener('click', closeAdminLoginModal);
  qs('admin-login-submit')?.addEventListener('click', handleAdminLogin);
  qs('admin-login-pin')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleAdminLogin();
  });
  qs('close-table-order-modal').addEventListener('click', () => qs('table-order-modal').classList.add('hidden'));
  qs('close-order-item-detail-modal')?.addEventListener('click', () => {
    activeOrderItemDraft = null;
    activeOrderItemDraftQty = 1;
    qs('order-item-detail-modal').classList.add('hidden');
  });
  qs('order-item-detail-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'order-item-detail-modal') {
      activeOrderItemDraft = null;
      activeOrderItemDraftQty = 1;
      qs('order-item-detail-modal').classList.add('hidden');
    }
  });
  qs('order-item-detail-qty-minus')?.addEventListener('click', () => {
    activeOrderItemDraftQty = Math.max(1, Number(activeOrderItemDraftQty || 1) - 1);
    qs('order-item-detail-qty-value').textContent = String(activeOrderItemDraftQty);
  });
  qs('order-item-detail-qty-plus')?.addEventListener('click', () => {
    activeOrderItemDraftQty = Math.max(1, Number(activeOrderItemDraftQty || 1) + 1);
    qs('order-item-detail-qty-value').textContent = String(activeOrderItemDraftQty);
  });
  qs('order-item-detail-add-btn')?.addEventListener('click', () => {
    if (!activeOrderItemDraft) return;
    const checked = [...document.querySelectorAll('#order-item-addon-checkboxes input[type="checkbox"]:checked')]
      .map((node) => node.value.trim())
      .filter(Boolean);
    const selectedAddons = checked.map((label) => parseAddonOption(label));
    addItemToOrderCart(activeOrderItemDraft, { addons: selectedAddons, qty: activeOrderItemDraftQty, note: '' });
    activeOrderItemDraft = null;
    activeOrderItemDraftQty = 1;
    qs('order-item-detail-modal').classList.add('hidden');
  });
  qs('close-payment-modal').addEventListener('click', () => {
    localStorage.setItem(CUSTOMER_DISPLAY_ACTIVE_TABLE_KEY, '0');
    syncCustomerDisplayActiveTable(0);
    activeCashierTableId = 0;
    qs('bill-payment-qr-wrap')?.classList.add('hidden');
    qs('payment-modal').classList.add('hidden');
  });
  qs('open-receipt-preview')?.addEventListener('click', () => qs('receipt-preview-modal').classList.remove('hidden'));
  qs('close-receipt-preview')?.addEventListener('click', () => qs('receipt-preview-modal').classList.add('hidden'));
  document.querySelectorAll('[data-sales-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      salesPeriod = btn.dataset.salesPeriod || 'day';
      salesFilterRange = null;
      document.querySelectorAll('[data-sales-period]').forEach((node) => node.classList.toggle('is-active', node === btn));
      renderSales();
      const range = periodRange(salesPeriod, new Date());
      const inRange = (db.sales || []).filter((sale) => salesDate(sale) >= range.start && salesDate(sale) <= range.end);
      openSalesPeriodModal(range, inRange);
    });
  });
  qs('close-sales-period-modal')?.addEventListener('click', () => qs('sales-period-modal')?.classList.add('hidden'));
  qs('sales-period-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'sales-period-modal') qs('sales-period-modal').classList.add('hidden');
  });
  qs('sales-range-apply')?.addEventListener('click', () => {
    const fromRaw = qs('sales-range-from')?.value;
    const toRaw = qs('sales-range-to')?.value;
    if (!fromRaw || !toRaw) return;
    const start = new Date(`${fromRaw}T00:00:00`);
    const end = new Date(`${toRaw}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return;
    const durationMs = end.getTime() - start.getTime() + 1;
    salesFilterRange = {
      start,
      end,
      previousStart: new Date(start.getTime() - durationMs),
      previousEnd: new Date(start.getTime() - 1),
      label: `ช่วงวันที่ ${fromRaw} ถึง ${toRaw}`,
    };
    renderSales();
    const inRange = (db.sales || []).filter((sale) => salesDate(sale) >= salesFilterRange.start && salesDate(sale) <= salesFilterRange.end);
    openSalesPeriodModal(salesFilterRange, inRange);
  });
  qs('paper-size')?.addEventListener('change', updateReceiptPreview);
  qs('store-name')?.addEventListener('input', updateReceiptPreview);

  qs('order-submit').addEventListener('click', submitOrderFromPanel);

  qs('bill-pay-cash').addEventListener('click', async () => {
    if (!activeCashierTableId) return;
    await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: activeCashierTableId, payment_method: 'cash' }) });
    localStorage.setItem(CUSTOMER_DISPLAY_ACTIVE_TABLE_KEY, '0');
    syncCustomerDisplayActiveTable(0);
    qs('payment-modal').classList.add('hidden');
    await loadData();
  });
  qs('bill-pay-qr').addEventListener('click', async () => {
    if (!activeCashierTableId) return;
    await api('/api/checkout', { method: 'POST', body: JSON.stringify({ target: 'table', target_id: activeCashierTableId, payment_method: 'qr' }) });
    localStorage.setItem(CUSTOMER_DISPLAY_ACTIVE_TABLE_KEY, '0');
    syncCustomerDisplayActiveTable(0);
    qs('payment-modal').classList.add('hidden');
    await loadData();
  });
  qs('open-customer-display-from-header')?.addEventListener('click', () => {
    const tableId = activeCashierTableId || selectedTableId;
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
  qs('add-menu-category')?.addEventListener('click', addMenuCategory);
  qs('menu-category-name')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addMenuCategory();
    }
  });

  qs('menu-image-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    menuImagePreviewData = await optimizeImageFile(file, {
      maxWidth: 720,
      maxHeight: 720,
      quality: 0.74,
      crop: 'square',
    });
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
    const category = qs('menu-category').value.trim() || 'ทั่วไป';
    const payload = { name, price, category, addons: addons.map((a) => `${a.name} (+${a.price})`), addon_json: addons, image: menuImagePreviewData || '' };
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
    renderOrderCategoryTabs();
  });

  qs('shop-logo-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await optimizeImageFile(file, {
      maxWidth: 420,
      maxHeight: 420,
      quality: 0.78,
      crop: 'square',
    });
    qs('shop-logo-preview').src = dataUrl;
  });

  qs('desk-accept-order')?.addEventListener('click', async () => {
    if (!selectedTableId || acceptRequestInFlight) return;
    const candidate = getTablePendingRequests(selectedTableId)
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0];
    if (!candidate?.id) return;
    acceptRequestInFlight = true;
    renderDeskSummary();
    try {
      await api('/api/table/accept', { method: 'POST', body: JSON.stringify({ order_id: candidate.id }) });
      await loadData();
    } finally {
      acceptRequestInFlight = false;
      renderDeskSummary();
    }
  });

  qs('desk-open-order-modal')?.addEventListener('click', () => { if (selectedTableId) selectTable(selectedTableId); });
  qs('order-request-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-order-id]');
    if (!button) return;
    const orderId = button.dataset.orderId;
    if (button.classList.contains('js-accept-request')) {
      await handlePendingRequestAction(orderId, 'accept');
      return;
    }
    if (button.classList.contains('js-reject-request')) {
      await handlePendingRequestAction(orderId, 'reject');
    }
  });
  qs('sales-list')?.addEventListener('click', async (event) => {
    const deleteBtn = event.target.closest('.js-sales-delete');
    if (!deleteBtn) return;
    const saleId = deleteBtn.dataset.saleId;
    if (!saleId) return;
    const ok = window.confirm('ลบประวัติรายการนี้?');
    if (!ok) return;
    await api('/api/sales/history', { method: 'DELETE', body: JSON.stringify({ sale_id: saleId }) });
    await loadData();
  });
  qs('sales-clear-history')?.addEventListener('click', async () => {
    const ok = window.confirm('ยืนยันลบประวัติยอดขายทั้งหมด?');
    if (!ok) return;
    await api('/api/sales/history', { method: 'DELETE', body: JSON.stringify({}) });
    await loadData();
  });
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
  qs('admin-login-forgot-btn')?.addEventListener('click', () => {
    closeAdminLoginModal();
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
  qs('create-backup-btn')?.addEventListener('click', async () => {
    const snapshot = await api('/api/backup');
    if (snapshot.error) {
      alert('สร้าง Backup ไม่สำเร็จ');
      return;
    }
    pushLocalBackup(snapshot);
    renderBackupList();
    alert('สำรองข้อมูลเรียบร้อย');
  });
  qs('backup-import-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const raw = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      alert('ไฟล์ Backup ไม่ถูกต้อง');
      event.target.value = '';
      return;
    }
    const ok = window.confirm('ยืนยันนำเข้า Backup นี้และเขียนทับข้อมูลเดิม?');
    if (!ok) {
      event.target.value = '';
      return;
    }
    const latestSnapshot = await api('/api/backup');
    if (!latestSnapshot.error) pushLocalBackup({ ...latestSnapshot, __source: 'before_restore' });
    const result = await api('/api/restore', { method: 'POST', body: JSON.stringify(parsed) });
    event.target.value = '';
    if (result.error) {
      alert('กู้คืนข้อมูลไม่สำเร็จ');
      return;
    }
    renderBackupList();
    await loadData();
    alert('กู้คืนข้อมูลจากไฟล์สำเร็จ');
  });
  qs('backup-history-list')?.addEventListener('click', async (event) => {
    const manageBtn = event.target.closest('.js-backup-manage');
    if (!manageBtn) return;
    const backupId = manageBtn.dataset.id;
    if (!backupId) return;
    const backup = readLocalBackups().find((row) => row.id === backupId);
    if (!backup?.payload) return;
    openBackupActionModal(backup);
  });
  qs('backup-action-download')?.addEventListener('click', () => {
    const backup = readLocalBackups().find((row) => row.id === activeBackupId);
    if (!backup?.payload) return;
    const stamp = String(backup.created_at || '').replace(/[:.]/g, '-');
    downloadJson(`pos-backup-local-${stamp}.json`, backup.payload);
    closeBackupActionModal();
  });
  qs('backup-action-restore')?.addEventListener('click', async () => {
    const backup = readLocalBackups().find((row) => row.id === activeBackupId);
    if (!backup?.payload) return;
    const ok = window.confirm('ยืนยันกู้คืนข้อมูลเก่าชุดนี้? ระบบจะเขียนทับข้อมูลปัจจุบัน');
    if (!ok) return;
    const result = await api('/api/restore', { method: 'POST', body: JSON.stringify(backup.payload) });
    if (result.error) {
      alert('กู้คืนข้อมูลไม่สำเร็จ');
      return;
    }
    closeBackupActionModal();
    await loadData();
    alert('กู้คืนข้อมูลสำเร็จ');
  });
  qs('backup-action-delete')?.addEventListener('click', async () => {
    const backup = readLocalBackups().find((row) => row.id === activeBackupId);
    if (!backup?.id) return;
    const ok = window.confirm('ยืนยันลบไฟล์ Backup นี้ออกจากรายการ?');
    if (!ok) return;
    deleteLocalBackup(backup.id);
    closeBackupActionModal();
    renderBackupList();
  });

  qs('save-system').addEventListener('click', async () => {
    let qrImage = db.settings?.qrImage || '';
    const logoImage = qs('shop-logo-preview').src || db.settings?.logoImage || '';
    const qrFile = qs('qr-image').files?.[0];
    if (qrFile) {
      qrImage = await optimizeImageFile(qrFile, {
        maxWidth: 820,
        maxHeight: 820,
        quality: 0.86,
        crop: 'none',
        mimeType: 'image/png',
      });
    }
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
    renderPaymentReadiness();
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
    const checkoutSet = new Set((info.tables || []).filter((t) => t.call_staff_status === 'requested').map((t) => t.id));
    const hasNewPending = [...pendingSet].some((id) => !lastPendingTableIds.has(id));
    const hasNewCheckoutRequest = [...checkoutSet].some((id) => !lastCheckoutRequestIds.has(id));
    if (hasNewPending) {
      playAlert('new-order-sound');
      [...pendingSet].filter((id) => !lastPendingTableIds.has(id)).forEach((tableId) => blinkTableCard(tableId));
    }
    if (hasNewCheckoutRequest) {
      playCheckoutAlertBurst(5000);
      playCallStaffAlertBurst(5000);
      [...checkoutSet].filter((id) => !lastCheckoutRequestIds.has(id)).forEach((tableId) => blinkTableCard(tableId));
    }
    lastPendingTableIds = pendingSet;
    lastCheckoutRequestIds = checkoutSet;
    await loadData();
  }
}

function connectLiveEvents() {
  if (liveEventSource || !window.EventSource) return;
  liveEventSource = new EventSource('/api/events');
  liveEventSource.addEventListener('update', () => poll());
  liveEventSource.onerror = () => {
    if (liveEventSource) liveEventSource.close();
    liveEventSource = null;
    setTimeout(connectLiveEvents, 2500);
  };
}

const tableBlinkTimers = new Map();
function blinkTableCard(tableId) {
  const card = document.querySelector(`.table-card[data-table-id="${tableId}"]`);
  if (!card) return;
  card.classList.add('blink-red');
  clearTimeout(tableBlinkTimers.get(tableId));
  const timer = setTimeout(() => {
    card.classList.remove('blink-red');
    tableBlinkTimers.delete(tableId);
  }, 3500);
  tableBlinkTimers.set(tableId, timer);
}

(async function init() {
  applyRoleUI();
  applyScannerModeUI();
  bind();
  await loadNetworkBaseUrl();
  await loadData();
  showScreen('customer');
  if (tableParam > 0) {
    selectedTableId = tableParam;
    showScreen('customer');
  }
  connectLiveEvents();
})();
