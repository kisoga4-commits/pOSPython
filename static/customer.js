let menu = [];
let cart = [];
let version = 0;
let currentSettings = {};
const params = new URLSearchParams(window.location.search);
const lockedTableId = Number(params.get('table') || document.body.dataset.tableId || 0);

const TABLE_STATUS_META = {
  available: { label: 'ว่าง', className: 'status-available' },
  pending_order: { label: 'รอรับออเดอร์', className: 'status-pending_order' },
  accepted_order: { label: 'กำลังให้บริการ', className: 'status-accepted_order' },
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

function renderMenu() {
  const list = document.getElementById('menu-list');
  list.innerHTML = '';
  menu.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'menu-btn';
    btn.innerHTML = `${item.image ? `<img src="${item.image}" class="menu-thumb" alt="${item.name}" />` : ''}<span>${item.name} - ${item.price}</span>`;
    btn.disabled = !lockedTableId;
    btn.addEventListener('click', () => {
      const addonChoices = Array.isArray(item.addons) ? item.addons : [];
      const addon = addonChoices.length ? (window.prompt(`เลือก add-on (${addonChoices.join(', ')})`, addonChoices[0]) || '') : '';
      cart.push({ ...item, addon: addon.trim() });
      renderCart();
    });
    list.appendChild(btn);
  });
}

function renderCart() {
  const list = document.getElementById('cart-list');
  list.innerHTML = '';
  const total = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);

  if (!cart.length) {
    list.innerHTML = '<div class="empty-state">ยังไม่มีรายการ</div>';
    return;
  }

  cart.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `${idx + 1}. ${item.name} - ${item.price} ${item.addon ? `· ${item.addon}` : ''}`;
    list.appendChild(row);
  });
  const totalRow = document.createElement('strong');
  totalRow.textContent = `รวม ${total}`;
  list.appendChild(totalRow);
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
    ? 'ระบบแจ้งพนักงานแล้ว กรุณารอสักครู่'
    : (table.status === 'accepted_order' ? 'พนักงานกำลังดูแลออเดอร์ของคุณ' : `สถานะล่าสุด: ${meta.label}`);
}

async function loadLive() {
  const data = await api(`/api/customer/live?since=${version}`);
  if (!data.changed) return;
  menu = data.menu || [];
  currentSettings = data.settings || {};
  version = data.version || version;
  setLockedTableUI();
  updateTableStatus(data.tables || []);
  renderMenu();
}

function setLockedTableUI() {
  const unit = currentSettings.serviceMode === 'queue' ? 'คิว' : 'โต๊ะ';
  const tableBadge = document.getElementById('table-badge');
  const note = document.getElementById('table-mode-note');
  if (lockedTableId > 0) {
    tableBadge.textContent = `${unit} ${lockedTableId}`;
    note.textContent = `สแกน QR ถูกต้อง ระบบผูกกับ${unit}นี้เรียบร้อย`;
  } else {
    tableBadge.className = 'badge status-checkout_requested';
    tableBadge.textContent = 'ไม่พบเลขโต๊ะ';
    note.textContent = 'กรุณาสแกน QR ที่โต๊ะเพื่อเข้าโหมดลูกค้า';
    document.getElementById('submit-order').disabled = true;
    document.getElementById('request-checkout').disabled = true;
  }
}

function bind() {
  document.getElementById('submit-order').addEventListener('click', async () => {
    if (!lockedTableId || !cart.length) return;

    const res = await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({ target: 'table', target_id: lockedTableId, cart, source: 'customer' }),
    });

    if (res.status === 'success') {
      document.getElementById('message').textContent = 'ส่งออเดอร์แล้ว ระบบแจ้งคิวเช็คบิลได้ทันที';
      cart = [];
      renderCart();
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
  loadLive().then(setLockedTableUI);
  setInterval(loadLive, 2000);
})();
