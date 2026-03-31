let version = 0;
let lastPendingIds = new Set();
let state = { tables: [], orders: [] };

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

function tableCard(table, actions = []) {
  const card = document.createElement('div');
  card.className = `list-item table-card status-${table.status}`;
  card.innerHTML = `<strong>โต๊ะ ${table.id}</strong><span class="badge status-${table.status}">${table.status}</span>`;
  const actionWrap = document.createElement('div');
  actionWrap.className = 'btn-row';
  actions.forEach((cfg) => {
    const btn = document.createElement('button');
    btn.className = cfg.className || 'btn-primary';
    btn.textContent = cfg.label;
    btn.addEventListener('click', cfg.onClick);
    actionWrap.appendChild(btn);
  });
  if (actions.length) card.appendChild(actionWrap);
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
    const actions = [];
    if (table.status === 'pending_order') {
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
      label: 'ปิดบิลโต๊ะนี้',
      className: 'btn-secondary',
      onClick: async () => {
        await api('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({ target: 'table', target_id: table.id }),
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
