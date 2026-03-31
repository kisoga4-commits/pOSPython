let menu = [];
let cart = [];
let version = 0;

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
  cart.forEach((item) => {
    const row = document.createElement('div');
    row.textContent = `${item.name} - ${item.price}`;
    list.appendChild(row);
  });
  const totalRow = document.createElement('strong');
  totalRow.textContent = `รวม ${total}`;
  list.appendChild(totalRow);
}

async function loadLive() {
  const data = await api(`/api/customer/live?since=${version}`);
  if (data.changed) {
    menu = data.menu || [];
    version = data.version || version;
    renderMenu();
  }
}

function bind() {
  document.getElementById('submit-order').addEventListener('click', async () => {
    const target = document.getElementById('target-type').value;
    const targetId = Number(document.getElementById('target-id').value || 0);
    if (!targetId || !cart.length) return;

    const res = await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({ target, target_id: targetId, cart, source: 'customer' }),
    });

    if (res.status === 'success') {
      document.getElementById('message').textContent = 'ส่งออเดอร์แล้ว';
      cart = [];
      renderCart();
    } else {
      document.getElementById('message').textContent = res.error || 'ส่งไม่สำเร็จ';
    }
  });
}

(function init() {
  bind();
  loadLive();
  setInterval(loadLive, 2500);
})();
