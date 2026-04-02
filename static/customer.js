let menu = [];
let cart = [];
let version = 0;
let currentSettings = {};
let currentTables = [];
let activeItemDraft = null;
let toastTimer = null;
let isInlineCartOpen = false;
let activeCategory = 'ทั้งหมด';
let submitState = 'idle';
let lastSubmittedOrderId = '';
let renderMenuTaskToken = 0;
let activeItemDraftQty = 1;
const params = new URLSearchParams(window.location.search);
function parseCombinedTableParam(rawValue = '') {
  const token = String(rawValue || '').trim();
  if (token.length < 5) return { tableId: 0, suffix: '', token: '' };
  const tablePrefix = token.slice(0, -4);
  const suffix = token.slice(-4);
  if (!/^\d+$/u.test(tablePrefix) || !/^[A-Za-z0-9]{4}$/u.test(suffix)) return { tableId: 0, suffix: '', token: '' };
  return { tableId: Number(tablePrefix), suffix, token };
}

const parsedToken = parseCombinedTableParam(params.get('t') || document.body.dataset.tableToken || '');
const lockedTableId = parsedToken.tableId || Number(params.get('table') || document.body.dataset.tableId || 0);
const lockedTableToken = parsedToken.token || '';
const masterBaseUrl = window.location.origin;
let liveEventSource = null;
const cartStorageKey = `customer_cart_table_${lockedTableId || 'unknown'}`;
const userRole = localStorage.getItem('user_role') || '';

const TABLE_STATUS_META = {
  available: { label: 'ว่าง', className: 'status-available' },
  pending_order: { label: 'กำลังรับออร์เดอร์', className: 'status-pending_order' },
  accepted_order: { label: 'มีลูกค้า', className: 'status-accepted_order' },
  checkout_requested: { label: 'เรียกเช็คบิล', className: 'status-checkout_requested' },
  closed: { label: 'ปิดบิล', className: 'status-closed' },
};
const VISUAL_MENU_LABELS = [
  { matcher: /เนื้อใบพายพรีเมียม/iu, symbol: '🥩✨' },
  { matcher: /หนูสันคอสไลน์/iu, symbol: '🐷🥓' },
];

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${window.location.origin}${path}`;
  const requestOptions = {
    ...options,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-POS-Role': 'customer', ...(options.headers || {}) },
  };
  const res = await fetch(url, requestOptions);
  return res.json();
}

function connectLiveEvents() {
  if (liveEventSource || !window.EventSource || !lockedTableId) return;
  const query = lockedTableToken
    ? `t=${encodeURIComponent(lockedTableToken)}`
    : `table_id=${encodeURIComponent(lockedTableId)}`;
  liveEventSource = new EventSource(`/api/events?${query}`);
  liveEventSource.addEventListener('update', () => loadLive());
  liveEventSource.onerror = () => {
    if (liveEventSource) liveEventSource.close();
    liveEventSource = null;
    setTimeout(connectLiveEvents, 2500);
  };
}

function boostPlaySound(soundId, gain = 1.6) {
  const baseAudio = document.getElementById(soundId);
  if (!baseAudio) return;
  const sourceUrl = baseAudio.currentSrc || baseAudio.src;
  if (!sourceUrl) return;
  const contextClass = window.AudioContext || window.webkitAudioContext;
  if (!contextClass) {
    baseAudio.currentTime = 0;
    baseAudio.volume = 1;
    baseAudio.play().catch(() => {});
    return;
  }
  const audioContext = new contextClass();
  const audioClone = new Audio(sourceUrl);
  audioClone.crossOrigin = 'anonymous';
  const source = audioContext.createMediaElementSource(audioClone);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = gain;
  source.connect(gainNode);
  gainNode.connect(audioContext.destination);
  audioClone.currentTime = 0;
  audioClone.play().catch(() => {});
}

function playAddToCartSound() {
  boostPlaySound('add-to-cart-sound', 1.8);
}

function playConfirmSound() {
  boostPlaySound('customer-confirm-sound', 1.8);
}

function playOrderSubmitSound() {
  boostPlaySound('customer-confirm-sound', 2.3);
}

function playCallStaffSound() {
  boostPlaySound('customer-call-staff-sound', 2.1);
}

function getStatusMeta(status) {
  return TABLE_STATUS_META[status] || TABLE_STATUS_META.available;
}

function money(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function applyBranding(settings = {}) {
  const logoSlot = document.getElementById('customer-logo-slot');
  const nameNode = document.getElementById('customer-store-name');
  const storeName = String(settings.storeName || 'FAKDU').trim() || 'FAKDU';
  if (nameNode) nameNode.textContent = storeName;
  if (logoSlot) {
    const logoImage = String(settings.logoImage || '').trim();
    logoSlot.innerHTML = logoImage ? `<img src="${logoImage}" alt="${storeName} logo" />` : '📱';
  }
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

function calculateCartTotal(items = cart) {
  return items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 1)), 0);
}

function cartIdentity(item) {
  const addonKey = (item.addons || [])
    .map((addon) => `${String(addon.name || '').trim()}:${Number(addon.price || 0)}`)
    .sort()
    .join('|');
  const baseId = item.item_id || item.id || item.name;
  return `${baseId}__${addonKey}__${(item.note || '').trim()}`;
}

function addToCart(item, options = {}) {
  const selectedAddons = Array.isArray(options.addons) ? options.addons : [];
  const addon = selectedAddons.map((addonItem) => addonItem.name).join(', ');
  const addonTotal = selectedAddons.reduce((sum, addonItem) => sum + Number(addonItem.price || 0), 0);
  const note = '';
  const qty = Math.max(1, Number(options.qty || 1));
  const baseItemId = item.item_id || item.id;
  const candidate = {
    ...item,
    item_id: baseItemId,
    base_price: Number(item.price || 0),
    price: Number(item.price || 0) + addonTotal,
    addon,
    addons: selectedAddons,
    note,
    qty,
  };
  candidate.cart_item_id = cartIdentity(candidate);
  const key = cartIdentity(candidate);
  const existing = cart.find((entry) => cartIdentity(entry) === key);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push(candidate);
  }
  persistCart();
  renderCart();
  refreshSubmitState();
  showAddedFeedback();
  playAddToCartSound();
}

function persistCart() {
  sessionStorage.setItem(cartStorageKey, JSON.stringify(cart));
  localStorage.setItem(cartStorageKey, JSON.stringify(cart));
}

function loadCartFromSession() {
  try {
    const raw = sessionStorage.getItem(cartStorageKey) || localStorage.getItem(cartStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) cart = parsed;
  } catch (error) {
    cart = [];
    sessionStorage.removeItem(cartStorageKey);
    localStorage.removeItem(cartStorageKey);
  }
}

function clearCart(closeModal = false) {
  cart = [];
  sessionStorage.removeItem(cartStorageKey);
  localStorage.removeItem(cartStorageKey);
  renderCart();
  if (closeModal) document.getElementById('cart-modal').classList.add('hidden');
}


function showAddedFeedback() {
  const cartButton = document.getElementById('floating-cart-btn');
  const toast = document.getElementById('cart-toast');
  cartButton.classList.remove('cart-bump');
  void cartButton.offsetWidth;
  cartButton.classList.add('cart-bump');
  clearTimeout(toastTimer);
  toast.classList.remove('hidden');
  toast.classList.add('show');
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hidden');
  }, 900);
}

function updateFloatingCart() {
  const count = cart.reduce((sum, item) => sum + Number(item.qty || 1), 0);
  const total = calculateCartTotal(cart);
  document.getElementById('floating-cart-count').textContent = `${count} ชิ้น`;
  document.getElementById('floating-cart-total').textContent = `฿${money(total)}`;
  const badge = document.getElementById('table-badge');
  if (lockedTableId) {
    badge.classList.toggle('status-pending_order', count > 0);
    badge.classList.toggle('status-accepted_order', count === 0);
  }
}

function buildAddonText(item) {
  const bits = [];
  if ((item.addons || []).length) bits.push(item.addons.map((addon) => addon.label || addon.name).join(', '));
  else if (item.addon) bits.push(item.addon);
  if (item.note) bits.push(`โน้ต: ${item.note}`);
  return bits.length ? `<small>${bits.join(' · ')}</small>` : '';
}

function menuVisualLabel(name = '') {
  const hit = VISUAL_MENU_LABELS.find((entry) => entry.matcher.test(String(name)));
  return hit ? hit.symbol : String(name || '');
}

function inlineCartToggleLabel() {
  return isInlineCartOpen ? '🧺 ▾' : '🧺 ▸';
}


function refreshSubmitState() {
  const submitButton = document.getElementById('submit-order');
  if (!submitButton) return;
  const hasItems = cart.length > 0;
  const isLocked = submitState === 'sending' || submitState === 'waiting_confirm';
  submitButton.disabled = !lockedTableId || !hasItems || isLocked;
  if (!lockedTableId) {
    submitButton.textContent = 'ส่งคำขอรายการ';
    return;
  }
  if (submitState === 'sending') {
    submitButton.textContent = 'กำลังส่ง...';
    return;
  }
  if (submitState === 'waiting_confirm') {
    submitButton.textContent = 'รอร้านยืนยันคำขอ';
    return;
  }
  submitButton.textContent = hasItems ? 'ส่งคำขอรายการ' : 'เพิ่มเมนูก่อนส่งคำขอ';
}

function resolveAdaptiveGridSize(count) {
  const total = Math.max(0, Number(count || 0));
  if (total <= 3) return 3;
  if (total <= 9) return 3;
  return 4;
}

function renderMenu() {
  const currentTaskToken = ++renderMenuTaskToken;
  const list = document.getElementById('menu-list');
  const tabs = document.getElementById('customer-category-tabs');
  list.innerHTML = '';
  const availableMenu = [...menu];
  const categories = ['ทั้งหมด', ...new Set(availableMenu.map((item) => item.category || 'ทั่วไป'))];
  if (!categories.includes(activeCategory)) activeCategory = 'ทั้งหมด';
  if (tabs) {
    tabs.innerHTML = '';
    categories.forEach((category) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `subtab ${category === activeCategory ? 'is-active' : ''}`;
      btn.textContent = category;
      btn.addEventListener('click', () => {
        activeCategory = category;
        renderMenu();
      });
      tabs.appendChild(btn);
    });
  }
  const displayMenu = availableMenu.filter((item) => activeCategory === 'ทั้งหมด' || (item.category || 'ทั่วไป') === activeCategory);
  list.dataset.gridSize = String(resolveAdaptiveGridSize(displayMenu.length));

  if (!displayMenu.length) {
    list.innerHTML = '<div class="empty">เมนูที่ยังไม่สั่งหมดแล้ว 🎉</div>';
    return;
  }

  const batchSize = 48;
  let cursor = 0;
  const renderNextBatch = () => {
    if (currentTaskToken !== renderMenuTaskToken) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(cursor + batchSize, displayMenu.length);
    for (let idx = cursor; idx < end; idx += 1) {
      const item = displayMenu[idx];
      const card = document.createElement('button');
      card.className = 'menu-mobile-card menu-tap-card';
      card.type = 'button';
      card.innerHTML = `
        <div class="menu-thumb">${item.image ? `<img src="${item.image}" alt="${item.name}" loading="lazy" decoding="async" />` : '🍜'}</div>
        <div class="menu-mobile-meta">
          <strong>${menuVisualLabel(item.name)}</strong>
          <small>${money(item.price)} บาท</small>
        </div>
      `;
      card.addEventListener('click', () => {
        if (!lockedTableId) return;
        const addonOptions = normalizeAddonOptions(item);
        if (!addonOptions.length) {
          addToCart(item, { addons: [], note: '', qty: 1 });
          return;
        }
        openItemDetailModal(item, addonOptions);
      });
      fragment.appendChild(card);
    }
    list.appendChild(fragment);
    cursor = end;
    if (cursor < displayMenu.length) window.requestAnimationFrame(renderNextBatch);
  };
  window.requestAnimationFrame(renderNextBatch);
}

function openItemDetailModal(item, addonOptions) {
  activeItemDraft = item;
  activeItemDraftQty = 1;
  document.getElementById('item-detail-title').textContent = menuVisualLabel(item.name);
  document.getElementById('item-detail-qty-value').textContent = String(activeItemDraftQty);
  const addonWrap = document.getElementById('item-addon-checkboxes');
  addonWrap.innerHTML = '';
  addonOptions.forEach((option) => {
    const parsed = parseAddonOption(option);
    const row = document.createElement('label');
    row.className = 'addon-check-item';
    row.innerHTML = `
      <input type="checkbox" value="${option}" />
      <span class="addon-option-row">
        <strong>${parsed.name}</strong>
        <small>${parsed.price > 0 ? `+${money(parsed.price)} บาท` : 'ฟรี'}</small>
      </span>
    `;
    addonWrap.appendChild(row);
  });
  document.getElementById('item-detail-modal').classList.remove('hidden');
}

function closeItemDetailModal() {
  document.getElementById('item-detail-modal').classList.add('hidden');
  activeItemDraft = null;
  activeItemDraftQty = 1;
}

function updateItemDraftQty(diff) {
  activeItemDraftQty = Math.max(1, Number(activeItemDraftQty || 1) + Number(diff || 0));
  const qtyNode = document.getElementById('item-detail-qty-value');
  if (qtyNode) qtyNode.textContent = String(activeItemDraftQty);
}

function updateCartItemQty(index, diff) {
  const item = cart[index];
  if (!item) return;
  item.qty = Number(item.qty || 1) + diff;
  if (item.qty <= 0) {
    cart.splice(index, 1);
  }
  persistCart();
  renderCart();
}

function renderCart() {
  const list = document.getElementById('cart-list');
  const inlineList = document.getElementById('inline-cart-panel');
  const toggleBtn = document.getElementById('toggle-current-cart');
  const totalNode = document.getElementById('cart-total');
  list.innerHTML = '';
  if (inlineList) inlineList.innerHTML = '';

  if (!cart.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการ</div>';
    if (inlineList) inlineList.innerHTML = '<div class="empty">ยังไม่มีรายการในตะกร้า</div>';
    totalNode.textContent = 'รวม 0 บาท';
    if (toggleBtn) toggleBtn.textContent = inlineCartToggleLabel();
    updateFloatingCart();
    refreshSubmitState();
    return;
  }

  cart.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-item cart-item-row';
    const lineTotal = Number(item.price || 0) * Number(item.qty || 1);
    row.innerHTML = `
      <div class="cart-item-main">
        <strong>${menuVisualLabel(item.name)}</strong>
        ${buildAddonText(item)}
      </div>
      <div class="cart-qty-wrap">
        <button type="button" class="btn-soft cart-qty-btn" data-action="minus">-</button>
        <span class="cart-qty-value">x${item.qty}</span>
        <button type="button" class="btn-soft cart-qty-btn" data-action="plus">+</button>
      </div>
      <strong class="cart-line-total">${money(lineTotal)}</strong>
    `;
    row.querySelector('[data-action="minus"]').addEventListener('click', () => updateCartItemQty(idx, -1));
    row.querySelector('[data-action="plus"]').addEventListener('click', () => updateCartItemQty(idx, 1));
    list.appendChild(row);

    if (inlineList) {
      const inlineRow = document.createElement('div');
      inlineRow.className = 'list-item';
      inlineRow.innerHTML = `<strong>${menuVisualLabel(item.name)}</strong> <span>x${item.qty}</span>`;
      inlineList.appendChild(inlineRow);
    }
  });
  const total = calculateCartTotal(cart);
  totalNode.textContent = `รวม ${money(total)} บาท`;
  if (inlineList) {
    const inlineTotal = document.createElement('div');
    inlineTotal.className = 'order-total';
    inlineTotal.textContent = `รวม ${money(total)} บาท`;
    inlineList.appendChild(inlineTotal);
  }
  if (toggleBtn) toggleBtn.textContent = inlineCartToggleLabel();
  updateFloatingCart();
  refreshSubmitState();
}

function updateTableStatus(tables = []) {
  if (!lockedTableId) return;
  const table = tables.find((item) => Number(item.id) === Number(lockedTableId));
  if (!table) return;
  const unit = currentSettings.serviceMode === 'queue' ? 'คิว' : 'โต๊ะ';

  const statusForDisplay = table.call_staff_status === 'requested' ? 'checkout_requested' : table.status;
  const meta = getStatusMeta(statusForDisplay);
  const note = document.getElementById('table-mode-note');
  const badge = document.getElementById('table-badge');
  badge.className = `badge ${meta.className}`;
  badge.textContent = `${unit} ${lockedTableId} · ${meta.label}`;
  note.textContent = table.status === 'pending_order'
    ? 'ส่งออร์เดอร์แล้ว · รอพนักงานกดรับ'
    : (table.status === 'accepted_order' ? 'พนักงานรับออร์เดอร์แล้ว · กำลังเตรียมอาหาร' : `สถานะล่าสุด: ${meta.label}`);
  if (table.call_staff_status === 'requested') {
    note.textContent = 'ส่งคำขอเรียกพนักงานแล้ว · รอร้านรับทราบ';
  } else if (table.call_staff_status === 'acknowledged') {
    note.textContent = 'ร้านรับทราบการเรียกพนักงานแล้ว · กรุณารอสักครู่';
  }
  if (table.last_order_event === 'rejected') {
    note.textContent = 'พนักงานปฏิเสธคำขอล่าสุด กรุณาส่งใหม่อีกครั้ง';
  }
  if (['available', 'closed'].includes(table.status) && cart.length) {
    clearCart();
    document.getElementById('message').textContent = 'โต๊ะนี้ถูกเคลียร์แล้ว ล้างตะกร้าให้อัตโนมัติ';
  }
  const callBtn = document.getElementById('call-staff-mini-btn');
  if (callBtn) {
    const busy = table.call_staff_status === 'requested';
    callBtn.disabled = busy;
    callBtn.textContent = busy ? '🔔 ส่งคำขอแล้ว' : '🔔 เรียกพนักงาน';
  }
}

function updateOrderAckIndicator(orders = []) {
  const indicator = document.getElementById('order-ack-indicator');
  if (!indicator) return;
  const tableOrders = orders
    .filter((order) => order.target === 'table' && Number(order.target_id) === Number(lockedTableId) && order.source === 'customer')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const latest = tableOrders[0];
  if (!latest) {
    indicator.className = 'badge order-ack-indicator hidden';
    indicator.textContent = '';
    return;
  }
  indicator.className = 'badge order-ack-indicator';
  if (latest.status === 'accepted') {
    indicator.classList.add('status-accepted_order');
    indicator.textContent = '✅ ร้านรับออร์เดอร์แล้ว';
    return;
  }
  if (latest.status === 'request_pending') {
    indicator.classList.add('status-pending_order');
    indicator.textContent = '🕒 รอร้านยืนยัน';
    return;
  }
  if (latest.status === 'cancelled') {
    indicator.classList.add('status-checkout_requested');
    indicator.textContent = '❌ คำขอถูกปฏิเสธ';
    return;
  }
  indicator.className = 'badge order-ack-indicator hidden';
  indicator.textContent = '';
}

function renderExistingOrders() {
  const list = document.getElementById('existing-order-list');
  const totalNode = document.getElementById('existing-order-total');
  const timeNode = document.getElementById('existing-order-time');
  const summaryNode = document.getElementById('existing-order-summary');
  const table = currentTables.find((t) => Number(t.id) === Number(lockedTableId));
  const items = table?.items || [];
  list.innerHTML = '';

  if (!items.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการที่ส่งเข้าร้าน</div>';
    totalNode.textContent = 'ยอดรวมปัจจุบัน 0 บาท';
    timeNode.textContent = 'ยังไม่มีเวลาออร์เดอร์';
    if (summaryNode) summaryNode.textContent = '(0 รายการ)';
    return;
  }

  const itemMap = new Map();
  items.forEach((item) => {
    const key = `${item.name}|${item.addon || ''}|${item.note || ''}|${Number(item.price || 0)}`;
    if (!itemMap.has(key)) {
      itemMap.set(key, { ...item, qty: 0 });
    }
    const current = itemMap.get(key);
    current.qty += Math.max(1, Number(item.qty || 1));
  });

  Array.from(itemMap.values()).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    const hasAddon = (Array.isArray(item.addons) && item.addons.length) || Boolean(item.addon);
    const qty = Math.max(1, Number(item.qty || 1));
    row.innerHTML = `${item.name}${qty > 1 ? ` x${qty}` : ''}${hasAddon ? ' <span class="addon-flag">➕</span>' : ''} · ${money(item.price)} บาท ${item.addon ? `· ${item.addon}` : ''} ${item.note ? `· ${item.note}` : ''}`;
    list.appendChild(row);
  });

  const total = items.reduce((sum, item) => sum + (Number(item.price || 0) * Math.max(1, Number(item.qty || 1))), 0);
  totalNode.textContent = `ยอดรวมปัจจุบัน ${money(total)} บาท`;
  timeNode.textContent = `อัปเดตล่าสุด ${new Date().toLocaleTimeString('th-TH', { hour12: false })}`;
  if (summaryNode) summaryNode.textContent = `(${Array.from(itemMap.values()).length} รายการ)`;
}

async function loadLive() {
  try {
    const query = lockedTableToken
      ? `since=${encodeURIComponent(version)}&t=${encodeURIComponent(lockedTableToken)}`
      : `since=${encodeURIComponent(version)}&table_id=${encodeURIComponent(lockedTableId)}`;
    const data = await api(`/api/customer/live?${query}`);
    if (!data.changed) {
      if (!menu.length) {
        const cachedMenu = await window.posDB.loadMenu();
        if (cachedMenu.length) {
          menu = cachedMenu;
          renderMenu();
        }
      }
      return;
    }
    menu = data.menu || [];
    currentSettings = data.settings || {};
    applyBranding(currentSettings);
    currentTables = data.tables || [];
    const tableOrders = (data.orders || []).filter((order) => Number(order.target_id) === Number(lockedTableId));
    const lastOrder = [...tableOrders].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
    const msg = document.getElementById('message');
    if (lastOrder && lastOrder.id === lastSubmittedOrderId) {
      if (lastOrder.status === 'request_pending') {
        submitState = 'waiting_confirm';
        msg.textContent = 'ส่งคำขอแล้ว · รอร้านยืนยัน';
        refreshSubmitState();
      } else if (lastOrder.status === 'accepted') {
        submitState = 'confirmed';
        msg.textContent = 'พนักงานยืนยันคำขอแล้ว';
        refreshSubmitState();
      } else if (lastOrder.status === 'cancelled') {
        submitState = 'rejected';
        msg.textContent = 'คำขอถูกปฏิเสธ กรุณาตรวจรายการแล้วส่งใหม่';
        refreshSubmitState();
      }
    }
    version = data.version || version;
    await window.posDB.saveMenu(menu);
    setLockedTableUI();
    updateTableStatus(data.tables || []);
    updateOrderAckIndicator(data.orders || []);
    renderMenu();
  } catch (error) {
    const cachedMenu = await window.posDB.loadMenu();
    if (cachedMenu.length) {
      menu = cachedMenu;
      renderMenu();
      document.getElementById('message').textContent = 'กำลังแสดงเมนูจากเครื่อง (Offline)';
    }
  }
}

async function validateCartAgainstTableStatus() {
  if (!lockedTableId) return;
  try {
    const query = lockedTableToken
      ? `since=0&t=${encodeURIComponent(lockedTableToken)}`
      : `since=0&table_id=${encodeURIComponent(lockedTableId)}`;
    const data = await api(`/api/customer/live?${query}`);
    const table = (data.tables || []).find((item) => Number(item.id) === Number(lockedTableId));
    if (!table) return;
    const isFreshTable = ['available', 'closed'].includes(table.status);
    if (isFreshTable) clearCart();
  } catch (error) {
    // keep current session cart when validation endpoint is unavailable
  }
}

function setLockedTableUI() {
  const unit = currentSettings.serviceMode === 'queue' ? 'คิว' : 'โต๊ะ';
  const tableBadge = document.getElementById('table-badge');
  const note = document.getElementById('table-mode-note');
  if (lockedTableId > 0) {
    tableBadge.textContent = `${unit} ${lockedTableId}`;
    note.textContent = `เชื่อมต่อ${unit}นี้แล้ว`;
  } else {
    tableBadge.className = 'badge status-checkout_requested';
    tableBadge.textContent = 'ไม่พบเลขโต๊ะ';
    note.textContent = 'กรุณาสแกน QR ที่โต๊ะเพื่อเข้าโหมดลูกค้า';
    document.getElementById('submit-order').disabled = true;
    document.getElementById('floating-cart-btn').disabled = true;
    refreshSubmitState();
  }
}

function bind() {
  const cartToggleBtn = document.getElementById('toggle-current-cart');
  if (cartToggleBtn) cartToggleBtn.textContent = inlineCartToggleLabel();
  document.getElementById('floating-cart-btn').addEventListener('click', () => {
    document.getElementById('cart-modal').classList.remove('hidden');
  });
  document.getElementById('toggle-current-cart')?.addEventListener('click', () => {
    isInlineCartOpen = !isInlineCartOpen;
    document.getElementById('inline-cart-panel')?.classList.toggle('hidden', !isInlineCartOpen);
    renderCart();
  });
  document.getElementById('close-cart-modal').addEventListener('click', () => {
    document.getElementById('cart-modal').classList.add('hidden');
  });
  document.getElementById('cart-modal').addEventListener('click', (event) => {
    if (event.target.id === 'cart-modal') document.getElementById('cart-modal').classList.add('hidden');
  });

  document.getElementById('close-item-detail-modal').addEventListener('click', closeItemDetailModal);
  document.getElementById('item-detail-modal').addEventListener('click', (event) => {
    if (event.target.id === 'item-detail-modal') closeItemDetailModal();
  });
  document.getElementById('item-detail-add-btn').addEventListener('click', () => {
    if (!activeItemDraft) return;
    const checked = [...document.querySelectorAll('#item-addon-checkboxes input[type="checkbox"]:checked')].map((node) => node.value.trim()).filter(Boolean);
    const selectedAddons = checked.map((label) => parseAddonOption(label));
    addToCart(activeItemDraft, { addons: selectedAddons, qty: activeItemDraftQty });
    closeItemDetailModal();
  });
  document.getElementById('item-detail-skip-addon-btn').addEventListener('click', () => {
    if (!activeItemDraft) return;
    addToCart(activeItemDraft, { addons: [], qty: activeItemDraftQty });
    closeItemDetailModal();
  });
  document.getElementById('item-detail-qty-minus').addEventListener('click', () => updateItemDraftQty(-1));
  document.getElementById('item-detail-qty-plus').addEventListener('click', () => updateItemDraftQty(1));

  document.getElementById('submit-order').addEventListener('click', async () => {
    if (!lockedTableId) return;
    if (!cart.length) {
      document.getElementById('message').textContent = 'ยังไม่มีเมนูในตะกร้า (ยอดรวม 0) กรุณาเพิ่มรายการก่อนส่ง';
      refreshSubmitState();
      return;
    }
    if (submitState === 'sending' || submitState === 'waiting_confirm') return;
    submitState = 'sending';
    refreshSubmitState();
    document.getElementById('message').textContent = 'กำลังส่งคำขอ...';

    const payloadCart = cart.map((item) => {
      const quantity = Math.max(1, Number(item.qty || item.quantity || 1));
      const unitPrice = Number(item.price || 0);
      return {
        item_id: item.item_id || item.id,
        id: item.item_id || item.id,
        cart_item_id: item.cart_item_id || cartIdentity(item),
        name: item.name,
        price: unitPrice,
        base_price: Number(item.base_price || item.price || 0),
        addon: item.addon || '',
        addons: (item.addons || []).map((addonItem) => ({
          name: addonItem.name,
          price: Number(addonItem.price || 0),
        })),
        note: item.note || '',
        quantity,
        qty: quantity,
        total: unitPrice * quantity,
        line_total: unitPrice * quantity,
      };
    });

    const pendingPayload = {
      client_order_id: `mobile-${lockedTableId}-${Date.now()}`,
      target: 'table',
      target_id: lockedTableId,
      table_token: lockedTableToken,
      cart: payloadCart,
      total_price: calculateCartTotal(cart),
      source: 'customer',
    };

    try {
      const res = await api('/api/order', {
        method: 'POST',
        body: JSON.stringify(pendingPayload),
      });

      if (res.status === 'success') {
        lastSubmittedOrderId = res.order?.id || '';
        submitState = 'waiting_confirm';
        document.getElementById('message').textContent = 'ส่งคำขอสำเร็จ · รอร้านยืนยัน';
        playOrderSubmitSound();
        clearCart();
        document.getElementById('cart-modal').classList.add('hidden');
        refreshSubmitState();
        await loadLive();
        return;
      }
      document.getElementById('message').textContent = res.error || 'ส่งไม่สำเร็จ';
      submitState = 'idle';
      refreshSubmitState();
    } catch (error) {
      await window.posDB.enqueuePendingOrder(pendingPayload);
      submitState = 'waiting_confirm';
      refreshSubmitState();
      document.getElementById('message').textContent = 'บันทึกคำขอไว้แล้ว จะซิงก์อัตโนมัติเมื่อเชื่อมต่อ LAN ได้';
      clearCart();
      document.getElementById('cart-modal').classList.add('hidden');
    }
  });
  document.getElementById('call-staff-mini-btn')?.addEventListener('click', async () => {
    if (!lockedTableId) return;
    const callBtn = document.getElementById('call-staff-mini-btn');
    if (callBtn) callBtn.disabled = true;
    const res = await api('/api/table/call-staff', {
      method: 'POST',
      body: JSON.stringify({
        table_id: lockedTableId,
        table_token: lockedTableToken,
      }),
    });
    if (res.error) {
      document.getElementById('message').textContent = `เรียกพนักงานไม่สำเร็จ: ${res.error}`;
      if (callBtn) callBtn.disabled = false;
      return;
    }
    playCallStaffSound();
    document.getElementById('message').textContent = 'ส่งคำขอเรียกพนักงานแล้ว';
    await loadLive();
  });
  document.getElementById('clear-cart-btn').addEventListener('click', () => {
    if (!cart.length) {
      document.getElementById('cart-modal').classList.add('hidden');
      return;
    }
    if (confirm('ต้องการล้างตะกร้าใช่หรือไม่?')) {
      clearCart(true);
    }
  });

}

(function init() {
  if (!lockedTableId) {
    document.getElementById('message').textContent = 'Invalid table access. กรุณาเข้าผ่าน QR Code เท่านั้น';
    document.getElementById('submit-order').disabled = true;
    refreshSubmitState();
    return;
  }
  if ('serviceWorker' in navigator) {
    const assetVersion = document.body.dataset.assetVersion || 'dev';
    navigator.serviceWorker
      .register(`/static/sw.js?v=${encodeURIComponent(assetVersion)}`)
      .then((registration) => registration.update())
      .catch(() => {});
  }
  bind();
  loadCartFromSession();
  renderCart();
  window.posSync.startSync(masterBaseUrl);
  validateCartAgainstTableStatus().then(() => loadLive()).then(setLockedTableUI);
  connectLiveEvents();
})();
