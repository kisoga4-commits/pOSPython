let version = 0;
let lastPendingIds = new Set();
let lastCheckoutIds = new Set();
let state = { tables: [], orders: [] };
let serviceMode = 'table';
const blinkTimers = new Map();
const STAFF_AUTH_KEY = 'fakdu_staff_auth';
let authState = null;

const TABLE_STATUS_META = {
  available: { label: 'ว่าง', className: 'status-available' },
  pending_order: { label: 'กำลังสั่ง', className: 'status-pending_order' },
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

function playCheckoutSound() {
  const audio = document.getElementById('checkout-request-sound');
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function playCallStaffSound() {
  const immediateAlert = new Audio('/static/alert.mp3');
  immediateAlert.play().catch(() => {
    const audio = document.getElementById('call-staff-sound');
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  });
}

function cartIdentity(item) {
  const addonKey = (item.addons || []).map((addon) => addon.name || addon).join('|');
  return `${item.id || item.name}__${addonKey}__${item.note || ''}`;
}

function stackItems(items = []) {
  const itemMap = new Map();
  items.forEach((item) => {
    const key = cartIdentity(item);
    if (!itemMap.has(key)) {
      itemMap.set(key, { ...item, qty: 0 });
    }
    const current = itemMap.get(key);
    current.qty += Math.max(1, Number(item.qty || 1));
  });
  return [...itemMap.values()];
}

function applyRoleRestrictions() {
  const allowedTabsForStaff = new Set(['customer', 'checkout']);
  const tabButtons = [...document.querySelectorAll('[data-staff-tab]')];
  tabButtons.forEach((tabButton) => {
    const visible = authState?.role !== 'staff' || allowedTabsForStaff.has(tabButton.dataset.staffTab);
    tabButton.classList.toggle('hidden', !visible);
  });

  if (authState?.role === 'staff') {
    const activeVisible = tabButtons.find((button) => button.classList.contains('is-active') && !button.classList.contains('hidden'));
    if (!activeVisible) {
      const defaultBtn = tabButtons.find((button) => button.dataset.staffTab === 'customer' && !button.classList.contains('hidden'));
      if (defaultBtn) defaultBtn.click();
    }
  }
}

function loadAuthState() {
  try {
    const raw = localStorage.getItem(STAFF_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.username || !parsed?.role) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function updateAuthUI() {
  const loginScreen = document.getElementById('staff-login-screen');
  const appScreen = document.getElementById('staff-app-screen');
  const nav = document.getElementById('staff-bottom-nav');
  const logoutBtn = document.getElementById('staff-logout-btn');
  const dot = document.getElementById('staff-online-dot');
  const online = navigator.onLine;
  dot.classList.toggle('online', online);
  dot.classList.toggle('offline', !online);
  if (authState) {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    nav.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    applyRoleRestrictions();
  } else {
    loginScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    nav.classList.add('hidden');
    logoutBtn.classList.add('hidden');
  }
}

function tableCard(table, orders = [], actions = []) {
  const meta = getStatusMeta(table.status);
  const unit = serviceMode === 'queue' ? 'คิว' : 'โต๊ะ';
  const card = document.createElement('div');
  card.className = `mobile-table-card table-card ${meta.className}`;
  card.dataset.tableId = String(table.id);
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
  if (orders.length) {
    const orderSummary = document.createElement('div');
    orderSummary.className = 'table-order-summary';
    stackItems(orders).slice(0, 4).forEach((item) => {
      const hasAddon = Array.isArray(item.addons) ? item.addons.length > 0 : Boolean(item.addon);
      const row = document.createElement('small');
      row.innerHTML = `• ${item.name} x${Math.max(1, Number(item.qty || 1))}${hasAddon ? '<span class="addon-flag">➕ Add-on</span>' : ''}`;
      orderSummary.appendChild(row);
    });
    card.appendChild(orderSummary);
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
          playCallStaffSound();
          await api('/api/table/accept', {
            method: 'POST',
            body: JSON.stringify({ table_id: table.id }),
          });
          await loadLive();
        },
      });
    }
    const tableItems = tableOrders.flatMap((order) => order.items || []);
    list.appendChild(tableCard(table, tableItems, actions));
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
    const tableItems = state.orders
      .filter((order) => order.target === 'table' && order.target_id === table.id && order.status !== 'cancelled')
      .flatMap((order) => order.items || []);
    list.appendChild(tableCard(table, tableItems, [{
      label: '💵 ปิดบิลเงินสด',
      className: 'btn-secondary',
      onClick: async () => {
        playCallStaffSound();
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
        playCallStaffSound();
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
  if (!authState) return;
  const data = await api(`/api/staff/live?since=${version}`);
  if (!data.changed) return;

  state = {
    tables: data.tables || [],
    orders: data.orders || [],
  };
  serviceMode = data.settings?.serviceMode || serviceMode;

  const pendingNow = new Set(state.tables.filter((table) => table.status === 'pending_order').map((table) => table.id));
  const checkoutNow = new Set(state.tables.filter((table) => table.status === 'checkout_requested').map((table) => table.id));
  const hasNewPending = [...pendingNow].some((id) => !lastPendingIds.has(id));
  const hasNewCheckout = [...checkoutNow].some((id) => !lastCheckoutIds.has(id));
  if (hasNewPending) playNewOrderSound();
  if (hasNewCheckout) playCheckoutSound();
  checkoutNow.forEach((tableId) => {
    if (!lastCheckoutIds.has(tableId)) blinkTableCard(tableId);
  });
  lastPendingIds = pendingNow;
  lastCheckoutIds = checkoutNow;

  version = data.version || version;
  renderCustomerTab();
  renderCheckoutTab();
}

function blinkTableCard(tableId) {
  const card = document.querySelector(`.table-card[data-table-id="${tableId}"]`);
  if (!card) return;
  card.classList.add('blink-red');
  clearTimeout(blinkTimers.get(tableId));
  const timeoutId = setTimeout(() => {
    card.classList.remove('blink-red');
    blinkTimers.delete(tableId);
  }, 5000);
  blinkTimers.set(tableId, timeoutId);
}

(function init() {
  authState = loadAuthState();
  updateAuthUI();
  bindTabs();
  document.getElementById('staff-login-btn').addEventListener('click', () => {
    const username = document.getElementById('staff-username').value.trim() || 'staff';
    const role = document.getElementById('staff-role').value;
    const pin = document.getElementById('staff-pin').value;
    const message = document.getElementById('staff-login-message');
    if (role === 'admin' && pin !== 'admin') {
      message.textContent = 'PIN Admin ไม่ถูกต้อง';
      return;
    }
    authState = { username, role };
    localStorage.setItem(STAFF_AUTH_KEY, JSON.stringify(authState));
    message.textContent = '';
    updateAuthUI();
    loadLive();
  });
  document.getElementById('staff-logout-btn').addEventListener('click', () => {
    localStorage.removeItem(STAFF_AUTH_KEY);
    authState = null;
    updateAuthUI();
  });
  window.addEventListener('online', updateAuthUI);
  window.addEventListener('offline', updateAuthUI);
  if (authState) loadLive();
  setInterval(loadLive, 2000);
})();
