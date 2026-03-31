let menu = [];
let cart = [];
let version = 0;
let currentSettings = {};
let currentTables = [];
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

function updateFloatingCart() {
  const count = cart.length;
  const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 1)), 0);
  document.getElementById('floating-cart-count').textContent = `${count} items`;
  document.getElementById('floating-cart-total').textContent = `฿${money(total)}`;
  const badge = document.getElementById('table-badge');
  if (lockedTableId) {
    badge.classList.toggle('status-pending_order', count > 0);
    badge.classList.toggle('status-accepted_order', count === 0);
  }
}

function renderMenu() {
  const list = document.getElementById('menu-list');
  list.innerHTML = '';
  menu.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'menu-mobile-card';
    card.innerHTML = `
      <div class="menu-thumb">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : '🍜'}</div>
      <div class="menu-mobile-meta">
        <strong>${item.name}</strong>
        <small>${money(item.price)} บาท</small>
      </div>
      <button class="menu-add-btn" type="button">+</button>
    `;
    card.querySelector('.menu-add-btn').addEventListener('click', (event) => {
      event.stopPropagation();
      if (!lockedTableId) return;
      cart.push({ ...item, addon: '', qty: 1, note: '' });
      renderCart();
    });
    list.appendChild(card);
  });
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
    row.className = 'list-item';
    row.innerHTML = `${idx + 1}. ${item.name} · ${item.qty} x ${money(item.price)} บาท <button class="btn-soft">ลบ</button>`;
    row.querySelector('button').addEventListener('click', () => {
      cart.splice(idx, 1);
      renderCart();
    });
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
    document.getElementById('request-checkout').disabled = true;
    document.getElementById('floating-cart-btn').disabled = true;
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

  document.getElementById('request-checkout').addEventListener('click', async () => {
    if (!lockedTableId) return;
    const res = await api('/api/table/checkout-request', {
      method: 'POST',
      body: JSON.stringify({ table_id: lockedTableId }),
    });
    document.getElementById('message').textContent = res.status === 'success' ? 'เรียกพนักงานเช็คบิลแล้ว' : (res.error || 'ทำรายการไม่สำเร็จ');
    await loadLive();
  });
}

(function init() {
  bind();
  renderCart();
  loadLive().then(setLockedTableUI);
  setInterval(loadLive, 2000);
})();
