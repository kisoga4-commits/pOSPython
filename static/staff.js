let version = 0;
let lastSeenIds = new Set();

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

function playNewOrderSound() {
  const audio = document.getElementById('new-order-sound');
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function renderOrders(orders) {
  const list = document.getElementById('orders');
  list.innerHTML = '';

  orders.slice().reverse().forEach((order) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `<strong>${order.id}</strong> | ${order.target} ${order.target_id} | ${order.status} | ${order.items.length} รายการ`;

    ['new', 'preparing', 'served'].forEach((status) => {
      const btn = document.createElement('button');
      btn.textContent = status;
      btn.addEventListener('click', async () => {
        await api('/api/order/status', {
          method: 'POST',
          body: JSON.stringify({ order_id: order.id, status }),
        });
        await loadLive();
      });
      row.appendChild(btn);
    });

    list.appendChild(row);
  });
}

async function loadLive() {
  const data = await api(`/api/staff/live?since=${version}`);
  if (!data.changed) return;

  const orders = data.orders || [];
  const incoming = orders.filter((o) => o.status === 'new' && !lastSeenIds.has(o.id));
  if (incoming.length) playNewOrderSound();

  lastSeenIds = new Set(orders.map((o) => o.id));
  version = data.version || version;
  renderOrders(orders);
}

(function init() {
  loadLive();
  setInterval(loadLive, 2000);
})();
