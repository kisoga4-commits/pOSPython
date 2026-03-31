let menu = [];
let cart = [];
let version = 0;
let currentSettings = {};
let currentTables = [];
let activeItemDraft = null;
let toastTimer = null;
const params = new URLSearchParams(window.location.search);
const lockedTableId = Number(params.get('table') || document.body.dataset.tableId || 0);

const TABLE_STATUS_META = {
  available: { label: 'ว่าง', className: 'status-available' },
  pending_order: { label: 'มีออร์เดอร์ใหม่', className: 'status-pending_order' },
  accepted_order: { label: 'กำลังทำ', className: 'status-accepted_order' },
  checkout_requested: { label: 'รอเช็คบิล', className: 'status-checkout_requested' },
  closed: { label: 'ปิดบิล', className: 'status-closed' },
};

async function api(path, options = {}) {
  const res = await fetch(path, {
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

function cartIdentity(item) {
  return `${item.id || item.name}__${(item.addon || '').trim()}__${(item.note || '').trim()}`;
}

function addToCart(item, options = {}) {
  const addon = String(options.addon || '').trim();
  const note = String(options.note || '').trim();
  const qty = Math.max(1, Number(options.qty || 1));
  const candidate = { ...item, addon, note, qty };
  const key = cartIdentity(candidate);
  const existing = cart.find((entry) => cartIdentity(entry) === key);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push(candidate);
  }
  renderCart();
  showAddedFeedback();
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
  const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 1)), 0);
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
  if (item.addon) bits.push(item.addon);
  if (item.note) bits.push(`โน้ต: ${item.note}`);
  return bits.length ? `<small>${bits.join(' · ')}</small>` : '';
}

function renderMenu() {
  const list = document.getElementById('menu-list');
  list.innerHTML = '';
  menu.forEach((item) => {
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
        addToCart(item, { addon: '', note: '', qty: 1 });
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
  const addonSelect = document.getElementById('item-addon-select');
  addonSelect.innerHTML = '<option value="">ไม่เพิ่ม</option>';
  addonOptions.forEach((option) => {
    const node = document.createElement('option');
    node.value = option;
    node.textContent = option;
    addonSelect.appendChild(node);
  });
  document.getElementById('item-note-input').value = '';
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
  renderCart();
}

function renderCart() {
  const list = document.getElementById('cart-list');
  const totalNode = document.getElementById('cart-total');
  list.innerHTML = '';

  if (!cart.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการ</div>';
    totalNode.textContent = 'รวม 0.00 บาท';
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
  });
  const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 1)), 0);
  totalNode.textContent = `รวม ${money(total)} บาท`;
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
}

function renderExistingOrders() {
  const list = document.getElementById('existing-order-list');
  const totalNode = document.getElementById('existing-order-total');
  const timeNode = document.getElementById('existing-order-time');
  const table = currentTables.find((t) => Number(t.id) === Number(lockedTableId));
  const items = table?.items || [];
  list.innerHTML = '';

  if (!items.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการที่ส่งเข้าร้าน</div>';
    totalNode.textContent = 'ยอดรวมปัจจุบัน 0.00 บาท';
    timeNode.textContent = 'ยังไม่มีเวลาออร์เดอร์';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `${item.name} · ${money(item.price)} บาท ${item.addon ? `· ${item.addon}` : ''} ${item.note ? `· ${item.note}` : ''}`;
    list.appendChild(row);
  });

  const total = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  totalNode.textContent = `ยอดรวมปัจจุบัน ${money(total)} บาท`;
  timeNode.textContent = `อัปเดตล่าสุด ${new Date().toLocaleTimeString('th-TH', { hour12: false })}`;
}

async function loadLive() {
  const data = await api(`/api/customer/live?since=${version}`);
  if (!data.changed) return;
  menu = data.menu || [];
  currentSettings = data.settings || {};
  currentTables = data.tables || [];
  version = data.version || version;
  setLockedTableUI();
  updateTableStatus(data.tables || []);
  renderMenu();
  renderExistingOrders();
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
    const addon = document.getElementById('item-addon-select').value;
    const note = document.getElementById('item-note-input').value;
    addToCart(activeItemDraft, { addon, note, qty: 1 });
    closeItemDetailModal();
  });

  document.getElementById('submit-order').addEventListener('click', async () => {
    if (!lockedTableId || !cart.length) return;

    const payloadCart = [];
    cart.forEach((item) => {
      const qty = Math.max(1, Number(item.qty || 1));
      for (let i = 0; i < qty; i += 1) {
        payloadCart.push({ name: item.name, price: item.price, addon: item.addon, note: item.note, qty: 1 });
      }
    });

    const res = await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({ target: 'table', target_id: lockedTableId, cart: payloadCart, source: 'customer' }),
    });

    if (res.status === 'success') {
      document.getElementById('message').textContent = 'ส่งออเดอร์เรียบร้อย';
      cart = [];
      renderCart();
      document.getElementById('cart-modal').classList.add('hidden');
      await loadLive();
    } else {
      document.getElementById('message').textContent = res.error || 'ส่งไม่สำเร็จ';
    }
  });

  document.getElementById('call-staff-bill').addEventListener('click', async () => {
    if (!lockedTableId) return;
    const res = await api('/api/table/checkout-request', {
      method: 'POST',
      body: JSON.stringify({ table_id: lockedTableId }),
    });
    document.getElementById('message').textContent = res.status === 'success' ? 'ส่งสัญญาณเรียกพนักงานแล้ว' : (res.error || 'ทำรายการไม่สำเร็จ');
    await loadLive();
  });
}

(function init() {
  bind();
  renderCart();
  loadLive().then(setLockedTableUI);
  setInterval(loadLive, 2000);
})();
