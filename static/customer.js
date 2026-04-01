let menu = [];
let cart = [];
let version = 0;
let currentSettings = {};
let currentTables = [];
let activeItemDraft = null;
let toastTimer = null;
let isInlineCartOpen = false;
let activeCategory = 'ทั้งหมด';
const params = new URLSearchParams(window.location.search);
const lockedTableId = Number(params.get('table') || document.body.dataset.tableId || 0);
let masterBaseUrl = document.body.dataset.localBaseUrl || `${window.location.protocol}//${window.location.host}`;
const cartStorageKey = `customer_cart_table_${lockedTableId || 'unknown'}`;
const userRole = localStorage.getItem('user_role') || '';

const TABLE_STATUS_META = {
  available: { label: 'ว่าง', className: 'status-available' },
  pending_order: { label: 'กำลังสั่ง', className: 'status-pending_order' },
  accepted_order: { label: 'กำลังทำ', className: 'status-accepted_order' },
  checkout_requested: { label: 'รอเช็คบิล', className: 'status-checkout_requested' },
  closed: { label: 'ปิดบิล', className: 'status-closed' },
};

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${masterBaseUrl}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

function getStatusMeta(status) {
  return TABLE_STATUS_META[status] || TABLE_STATUS_META.available;
}

function money(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  showAddedFeedback();
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

function renderMenu() {
  const list = document.getElementById('menu-list');
  const tabs = document.getElementById('customer-category-tabs');
  list.innerHTML = '';
  const table = currentTables.find((entry) => Number(entry.id) === Number(lockedTableId));
  const existingItems = Array.isArray(table?.items) ? table.items : [];
  const orderedItemIds = new Set(existingItems.map((item) => Number(item.item_id || item.id)).filter((id) => Number.isFinite(id) && id > 0));
  const orderedItemNames = new Set(existingItems.map((item) => String(item.name || '').trim()).filter(Boolean));
  const availableMenu = menu.filter((item) => {
    const itemId = Number(item.item_id || item.id || 0);
    if (Number.isFinite(itemId) && itemId > 0 && orderedItemIds.has(itemId)) return false;
    return !orderedItemNames.has(String(item.name || '').trim());
  });
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

  if (!displayMenu.length) {
    list.innerHTML = '<div class="empty">เมนูที่ยังไม่สั่งหมดแล้ว 🎉</div>';
    return;
  }

  displayMenu.forEach((item) => {
    const card = document.createElement('button');
    card.className = 'menu-mobile-card menu-tap-card';
    card.type = 'button';
    card.innerHTML = `
      <div class="menu-thumb">${item.image ? `<img src="${item.image}" alt="${item.name}" loading="lazy" decoding="async" />` : '🍜'}</div>
      <div class="menu-mobile-meta">
        <strong>${item.name}</strong>
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
    list.appendChild(card);
  });
}

function openItemDetailModal(item, addonOptions) {
  activeItemDraft = item;
  document.getElementById('item-detail-title').textContent = item.name;
  const addonWrap = document.getElementById('item-addon-checkboxes');
  addonWrap.innerHTML = '';
  addonOptions.forEach((option) => {
    const row = document.createElement('label');
    row.className = 'addon-check-item';
    row.innerHTML = `<input type="checkbox" value="${option}" /> <span>${option}</span>`;
    addonWrap.appendChild(row);
  });
  document.getElementById('item-detail-modal').classList.remove('hidden');
}

function closeItemDetailModal() {
  document.getElementById('item-detail-modal').classList.add('hidden');
  activeItemDraft = null;
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
    totalNode.textContent = 'รวม 0.00 บาท';
    if (toggleBtn) toggleBtn.textContent = isInlineCartOpen ? '▼ ตะกร้าปัจจุบัน (ซ่อน)' : '▶ ตะกร้าปัจจุบัน (เปิด)';
    updateFloatingCart();
    return;
  }

  cart.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-item cart-item-row';
    const lineTotal = Number(item.price || 0) * Number(item.qty || 1);
    row.innerHTML = `
      <div class="cart-item-main">
        <strong>${item.name}</strong>
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
      inlineRow.innerHTML = `<strong>${item.name}</strong> <span>x${item.qty}</span>`;
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
  if (toggleBtn) toggleBtn.textContent = isInlineCartOpen ? '▼ ตะกร้าปัจจุบัน (ซ่อน)' : '▶ ตะกร้าปัจจุบัน (เปิด)';
  updateFloatingCart();
}

function updateTableStatus(tables = []) {
  if (!lockedTableId) return;
  const table = tables.find((item) => Number(item.id) === Number(lockedTableId));
  if (!table) return;
  const unit = currentSettings.serviceMode === 'queue' ? 'คิว' : 'โต๊ะ';

  const meta = getStatusMeta(table.status);
  const note = document.getElementById('table-mode-note');
  const badge = document.getElementById('table-badge');
  badge.className = `badge ${meta.className}`;
  badge.textContent = `${unit} ${lockedTableId} · ${meta.label}`;
  note.textContent = table.status === 'pending_order'
    ? 'ส่งออร์เดอร์แล้ว · รอพนักงานกดรับ'
    : (table.status === 'accepted_order' ? 'พนักงานรับออร์เดอร์แล้ว · กำลังเตรียมอาหาร' : `สถานะล่าสุด: ${meta.label}`);
  if (['available', 'closed'].includes(table.status) && cart.length) {
    clearCart();
    document.getElementById('message').textContent = 'โต๊ะนี้ถูกเคลียร์แล้ว ล้างตะกร้าให้อัตโนมัติ';
  }
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
    totalNode.textContent = 'ยอดรวมปัจจุบัน 0.00 บาท';
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
    const data = await api(`/api/customer/live?since=${version}&table_id=${encodeURIComponent(lockedTableId)}`);
    if (!data.changed) return;
    menu = data.menu || [];
    currentSettings = data.settings || {};
    currentTables = data.tables || [];
    version = data.version || version;
    await window.posDB.saveMenu(menu);
    setLockedTableUI();
    updateTableStatus(data.tables || []);
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
    const data = await api(`/api/customer/live?since=0&table_id=${encodeURIComponent(lockedTableId)}`);
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
    document.getElementById('call-staff-bill').disabled = true;
  }
}

function bind() {
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
    addToCart(activeItemDraft, { addons: selectedAddons, qty: 1 });
    closeItemDetailModal();
  });

  document.getElementById('submit-order').addEventListener('click', async () => {
    if (!lockedTableId || !cart.length) return;

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
      client_order_id: `mobile-${Date.now()}`,
      target: 'table',
      target_id: lockedTableId,
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
        document.getElementById('message').textContent = 'ส่งออเดอร์เรียบร้อย';
        clearCart();
        document.getElementById('cart-modal').classList.add('hidden');
        await loadLive();
        return;
      }
      document.getElementById('message').textContent = res.error || 'ส่งไม่สำเร็จ';
    } catch (error) {
      await window.posDB.enqueuePendingOrder(pendingPayload);
      document.getElementById('message').textContent = 'บันทึกคำสั่งซื้อไว้แล้ว จะซิงก์อัตโนมัติเมื่อเชื่อมต่อ LAN ได้';
      clearCart();
      document.getElementById('cart-modal').classList.add('hidden');
    }
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

  document.getElementById('call-staff-bill').addEventListener('click', async () => {
    if (!lockedTableId) return;
    const res = await api('/api/table/checkout-request', {
      method: 'POST',
      body: JSON.stringify({ table_id: lockedTableId }),
    });
    document.getElementById('message').textContent = res.status === 'success' ? 'ส่งสัญญาณเรียกพนักงานแล้ว' : (res.error || 'ทำรายการไม่สำเร็จ');
    const sound = document.getElementById('customer-confirm-sound');
    if (sound) {
      sound.currentTime = 0;
      sound.volume = 0.4;
      sound.play().catch(() => {});
    }
    await loadLive();
  });
}

(function init() {
  if (userRole === 'staff' && lockedTableId) {
    window.location.replace(`/?table=${encodeURIComponent(lockedTableId)}&staff_scan=1`);
    return;
  }

  if (!lockedTableId) {
    document.getElementById('message').textContent = 'Invalid table access. กรุณาเข้าผ่าน QR Code เท่านั้น';
    document.getElementById('submit-order').disabled = true;
    document.getElementById('call-staff-bill').disabled = true;
    return;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/sw.js').catch(() => {});
  }
  bind();
  loadCartFromSession();
  renderCart();
  window.posSync.startSync(masterBaseUrl);
  validateCartAgainstTableStatus().then(() => loadLive()).then(setLockedTableUI);
  setInterval(loadLive, 3000);
})();
