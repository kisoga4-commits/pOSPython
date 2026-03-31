let version = 0;
let lastPendingIds = new Set();
let state = { tables: [], orders: [] };
let serviceMode = 'table';

const TABLE_STATUS_META = {
  available: { label: 'ว่าง', className: 'status-available' },
  pending_order: { label: 'ออร์เดอร์ค้าง/ลูกค้าสั่งเอง', className: 'status-pending_order' },
  accepted_order: { label: 'มีลูกค้า', className: 'status-accepted_order' },
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

function playNewOrderSound() {
  const audio = document.getElementById('new-order-sound');
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function tableCard(table, actions = []) {
  const meta = getStatusMeta(table.status);
  const unit = serviceMode === 'queue' ? 'คิว' : 'โต๊ะ';
  const card = document.createElement('div');
  card.className = `mobile-table-card table-card ${meta.className}`;
  card.innerHTML = `
    <div class="mobile-table-head">
      <strong>${unit} ${table.id}</strong>
      <span class="status-badge ${meta.className}">${meta.label}</span>
    </div>
  `;

  if (table.status === 'pending_order') {
    const notify = document.createElement('div');
    notify.className = 'dot-notify';
    notify.textContent = '🔔 ลูกค้าสั่งจาก QR';
    card.appendChild(notify);
  }

  if (actions.length) {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'btn-row';
    actions.forEach((cfg) => {
      const btn = document.createElement('button');
      btn.className = cfg.className || 'btn-primary';
      btn.textContent = cfg.label;
      btn.addEventListener('click', cfg.onClick);
      actionWrap.appendChild(btn);
    });
    card.appendChild(actionWrap);
  }
  return card;
}

function renderCustomerTab() {
  const list = document.getElementById('staff-customer-list');
  list.innerHTML = '';
  const customerTables = state.tables.filter((table) => ['pending_order', 'accepted_order'].includes(table.status));

  if (!customerTables.length) {
    list.innerHTML = '<div class="empty-state">ยังไม่มีโต๊ะรอดำเนินการ</div>';
    return;
  }

  customerTables.forEach((table) => {
    const tableOrders = state.orders.filter((order) => order.target === 'table' && order.target_id === table.id && order.status !== 'cancelled');
    const hasCustomerNewOrder = tableOrders.some((order) => order.source === 'customer' && order.status === 'new');
    const actions = [];
    if (hasCustomerNewOrder) {
      actions.push({
        label: 'รับออร์เดอร์',
        className: 'btn-primary',
        onClick: async () => {
          await api('/api/table/accept', {
            method: 'POST',
            body: JSON.stringify({ table_id: table.id }),
          });
          await loadLive();
        },
      });
    }
    list.appendChild(tableCard(table, actions));
  });
}

function renderCheckoutTab() {
  const list = document.getElementById('staff-checkout-list');
  list.innerHTML = '';
  const checkoutTables = state.tables.filter((table) => table.status === 'checkout_requested');

  if (!checkoutTables.length) {
    list.innerHTML = '<div class="empty-state">ยังไม่มีโต๊ะรอเช็คบิล</div>';
    return;
  }

  checkoutTables.forEach((table) => {
    list.appendChild(tableCard(table, [{
      label: '💵 ปิดบิลเงินสด',
      className: 'btn-secondary',
      onClick: async () => {
        await api('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({ target: 'table', target_id: table.id, payment_method: 'cash' }),
        });
        await loadLive();
      },
    }, {
      label: '📱 ปิดบิล QR',
      className: 'btn-secondary',
      onClick: async () => {
        await api('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({ target: 'table', target_id: table.id, payment_method: 'qr' }),
        });
        await loadLive();
      },
    }]));
  });
}

function bindTabs() {
  document.querySelectorAll('[data-staff-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.staffTab;
      document.querySelectorAll('[data-staff-tab]').forEach((node) => node.classList.toggle('is-active', node === btn));
      document.getElementById('staff-tab-customer').classList.toggle('hidden', target !== 'customer');
      document.getElementById('staff-tab-checkout').classList.toggle('hidden', target !== 'checkout');
    });
  });
}

async function loadLive() {
  const data = await api(`/api/staff/live?since=${version}`);
  if (!data.changed) return;

  state = {
    tables: data.tables || [],
    orders: data.orders || [],
  };
  serviceMode = data.settings?.serviceMode || serviceMode;

  const pendingNow = new Set(state.tables.filter((table) => table.status === 'pending_order').map((table) => table.id));
  const hasNewPending = [...pendingNow].some((id) => !lastPendingIds.has(id));
  if (hasNewPending) playNewOrderSound();
  lastPendingIds = pendingNow;

  version = data.version || version;
  renderCustomerTab();
  renderCheckoutTab();
}

(function init() {
  bindTabs();
  loadLive();
  setInterval(loadLive, 2000);
})();
