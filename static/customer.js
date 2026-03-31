let menu = [];
let cart = [];
let version = 0;
const params = new URLSearchParams(window.location.search);
const lockedTableId = Number(params.get('table') || document.body.dataset.tableId || 0);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

function renderMenu() {
  const list = document.getElementById('menu-list');
  list.innerHTML = '';
  menu.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'menu-btn';
    btn.textContent = `${item.name} - ${item.price}`;
    btn.addEventListener('click', () => {
      cart.push(item);
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

  cart.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.textContent = `${item.name} - ${item.price}`;
    list.appendChild(row);
  });
  const totalRow = document.createElement('strong');
  totalRow.textContent = `รวม ${total}`;
  list.appendChild(totalRow);
}

async function loadLive() {
  const data = await api(`/api/customer/live?since=${version}`);
  if (!data.changed) return;
  menu = data.menu || [];
  version = data.version || version;
  renderMenu();
}

function setLockedTableUI() {
  const tableBadge = document.getElementById('table-badge');
  if (lockedTableId > 0) {
    tableBadge.textContent = `โต๊ะ ${lockedTableId}`;
  } else {
    tableBadge.textContent = 'ไม่พบเลขโต๊ะ';
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
      document.getElementById('message').textContent = 'ส่งออเดอร์แล้ว';
      cart = [];
      renderCart();
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
  });
}

(function init() {
  setLockedTableUI();
  bind();
  loadLive();
  setInterval(loadLive, 2000);
})();
