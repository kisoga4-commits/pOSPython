let version = 0;
let lastPendingIds = new Set();
let lastCheckoutIds = new Set();
let state = { tables: [], orders: [] };
let serviceMode = 'table';
const blinkTimers = new Map();
const USER_ROLE_KEY = 'user_role';
let authState = null;
let liveEventSource = null;
let callStaffAlertUntil = 0;

if (document.body?.dataset.autoStaff === '1') {
  localStorage.setItem(USER_ROLE_KEY, 'staff');
}

const TABLE_STATUS_META = {
  available: { label: 'ว่าง', className: 'status-available' },
  pending_order: { label: 'กำลังรับออร์เดอร์', className: 'status-pending_order' },
  accepted_order: { label: 'มีลูกค้า', className: 'status-accepted_order' },
  checkout_requested: { label: 'เรียกเช็คบิล', className: 'status-checkout_requested' },
  closed: { label: 'ปิดบิล', className: 'status-closed' },
};

async function api(path, options = {}) {
  const optionHeaders = options.headers || {};
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-POS-Role': 'staff', ...optionHeaders },
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
  audio.volume = 1;
  audio.playbackRate = 1;
  audio.play().catch(() => {});
}

function playCheckoutSound() {
  const audio = document.getElementById('checkout-request-sound');
  if (!audio) return;
  audio.currentTime = 0;
  audio.volume = 1;
  audio.playbackRate = 1;
  audio.play().catch(() => {});
}

function playCallStaffSound() {
  const audio = document.getElementById('call-staff-sound');
  if (!audio) return;
  audio.currentTime = 0;
  audio.volume = 1;
  audio.playbackRate = 1;
  audio.preservesPitch = false;
  audio.play().catch(() => {});
}

function playCallStaffAlertBurst(durationMs = 5000) {
  callStaffAlertUntil = Math.max(callStaffAlertUntil, Date.now() + durationMs);
  const tick = () => {
    if (Date.now() > callStaffAlertUntil) return;
    playCallStaffSound();
    setTimeout(tick, 900);
  };
  tick();
}

function applyBranding(settings = {}) {
  const logoSlot = document.getElementById('staff-logo-slot');
  const nameNode = document.getElementById('staff-store-name');
  const storeName = String(settings.storeName || 'FAKDU').trim() || 'FAKDU';
  if (nameNode) nameNode.textContent = storeName;
  if (logoSlot) {
    const logoImage = String(settings.logoImage || '').trim();
    logoSlot.innerHTML = logoImage ? `<img src="${logoImage}" alt="${storeName} logo" />` : '📱';
  }
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
  const role = localStorage.getItem(USER_ROLE_KEY);
  if (role === 'staff') return { role: 'staff' };
  return null;
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
  if (authState?.role === 'staff') {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    nav.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    applyRoleRestrictions();
    connectLiveEvents();
  } else {
    loginScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    nav.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    disconnectLiveEvents();
  }
}

function connectLiveEvents() {
  if (liveEventSource || !window.EventSource) return;
  liveEventSource = new EventSource('/api/events');
  liveEventSource.addEventListener('update', () => {
    loadLive().catch(() => {});
  });
  liveEventSource.onerror = () => {
    disconnectLiveEvents();
    setTimeout(connectLiveEvents, 2500);
  };
}

function disconnectLiveEvents() {
  if (!liveEventSource) return;
  liveEventSource.close();
  liveEventSource = null;
}

function tableCard(table, orders = [], actions = [], options = {}) {
  const showQty = options.showQty !== false;
  const meta = getStatusMeta(table.status);
  const unit = serviceMode === 'queue' ? 'คิว' : 'โต๊ะ';
  const card = document.createElement('div');
  card.className = `mobile-table-card table-card ${meta.className}`;
  card.dataset.tableId = String(table.id);
  if (table.call_staff_status === 'requested') {
    card.classList.add('status-checkout_requested');
  }
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
  if (table.has_additional_order) {
    const addMoreNotify = document.createElement('div');
    addMoreNotify.className = 'dot-notify notify-additional';
    addMoreNotify.textContent = '🆕 โต๊ะนี้มีการสั่งเพิ่ม';
    card.appendChild(addMoreNotify);
  }
  if (table.call_staff_status === 'requested') {
    const callNotify = document.createElement('div');
    callNotify.className = 'dot-notify';
    callNotify.textContent = '🚨 เรียกพนักงาน';
    card.appendChild(callNotify);
  } else if (table.call_staff_status === 'acknowledged') {
    const ackNotify = document.createElement('div');
    ackNotify.className = 'dot-notify notify-additional';
    ackNotify.textContent = '✅ รับรู้แล้ว';
    card.appendChild(ackNotify);
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
      row.className = 'summary-item';
      const qty = Math.max(1, Number(item.qty || 1));
      const thumb = item.image ? `<img src="${item.image}" alt="${item.name}" class="table-order-thumb" />` : '<span class="table-order-thumb">🍽️</span>';
      row.innerHTML = `${thumb}<span>${item.name}${showQty && qty > 1 ? ` x${qty}` : ''}${hasAddon ? '<span class="addon-flag">➕</span>' : ''}</span>`;
      orderSummary.appendChild(row);
    });
    card.appendChild(orderSummary);
  }
  return card;
}

function renderCustomerTab() {
  const list = document.getElementById('staff-customer-list');
  list.innerHTML = '';
  const customerTables = state.tables.filter((table) => (
    ['pending_order', 'accepted_order'].includes(table.status)
    || table.call_staff_status === 'requested'
  ));

  if (!customerTables.length) {
    list.dataset.gridSize = '3';
    list.innerHTML = '<div class="empty-state">ยังไม่มีโต๊ะรอดำเนินการ</div>';
    return;
  }
  list.dataset.gridSize = customerTables.length > 9 ? '4' : '3';

  customerTables.forEach((table) => {
    const tableOrders = state.orders.filter((order) => order.target === 'table' && order.target_id === table.id && order.status !== 'cancelled');
    const pendingRequests = tableOrders.filter((order) => order.source === 'customer' && order.status === 'request_pending');
    const hasAcceptedBefore = tableOrders.some((order) => order.status === 'accepted');
    table.has_additional_order = pendingRequests.length > 0 && hasAcceptedBefore;
    const tableTotal = tableOrders.flatMap((order) => order.items || []).reduce((sum, item) => {
      const qty = Math.max(1, Number(item.qty || 1));
      return sum + (Number(item.price || 0) * qty);
    }, 0);
    const actions = [];
    if (table.call_staff_status === 'requested') {
      actions.push({
        label: '🔕 รับรู้การเรียกพนักงาน',
        className: 'btn-primary',
        onClick: async () => {
          await api('/api/table/call-staff/ack', {
            method: 'POST',
            body: JSON.stringify({ table_id: table.id }),
          });
          await loadLive();
        },
      });
    }
    pendingRequests.forEach((requestOrder) => {
      actions.push({
        label: `✅ ยืนยันคำขอ ${requestOrder.id}`,
        className: 'btn-primary',
        onClick: async () => {
          playCallStaffSound();
          await api('/api/table/accept', {
            method: 'POST',
            body: JSON.stringify({ order_id: requestOrder.id }),
          });
          await loadLive();
        },
      });
      actions.push({
        label: `❌ ปฏิเสธ ${requestOrder.id}`,
        className: 'btn-soft',
        onClick: async () => {
          await api('/api/table/reject', {
            method: 'POST',
            body: JSON.stringify({ order_id: requestOrder.id }),
          });
          await loadLive();
        },
      });
    });
    const tableItems = tableOrders.flatMap((order) => order.items || []);
    list.appendChild(tableCard(table, tableItems, actions));
  });
}

function renderCheckoutTab() {
  const list = document.getElementById('staff-checkout-list');
  list.innerHTML = '';
  const checkoutTables = state.tables.filter((table) => (
    table.call_staff_status === 'requested'
    || state.orders.some((order) => order.target === 'table' && order.target_id === table.id && order.status === 'accepted')
  ));

  if (!checkoutTables.length) {
    list.dataset.gridSize = '3';
    list.innerHTML = '<div class="empty-state">ยังไม่มีโต๊ะรอเช็คบิล</div>';
    return;
  }
  list.dataset.gridSize = checkoutTables.length > 9 ? '4' : '3';

  checkoutTables.forEach((table) => {
    const tableItems = state.orders
      .filter((order) => order.target === 'table' && order.target_id === table.id && order.status !== 'cancelled')
      .flatMap((order) => order.items || []);
    const expandedItems = tableItems.flatMap((item) => {
      const qty = Math.max(1, Number(item.qty || 1));
      return Array.from({ length: qty }, () => ({ ...item, qty: 1 }));
    });
    const actions = [{
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
    }];
    if (table.call_staff_status === 'requested') {
      actions.unshift({
        label: '🔕 รับรู้การเรียกพนักงาน',
        className: 'btn-primary',
        onClick: async () => {
          await api('/api/table/call-staff/ack', {
            method: 'POST',
            body: JSON.stringify({ table_id: table.id }),
          });
          await loadLive();
        },
      });
    }
    list.appendChild(tableCard(table, expandedItems, actions, { showQty: false }));
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
  const [data, rawData] = await Promise.all([
    api('/api/staff/bootstrap'),
    api('/api/data'),
  ]);
  applyBranding(rawData?.settings || {});
  applySnapshot(data.snapshot || {});
}

function applySnapshot(snapshot = {}) {
  state = {
    tables: snapshot.tables || [],
    orders: snapshot.orders || [],
  };
  serviceMode = snapshot.service_mode || serviceMode;
  version = snapshot.version || version;
  refreshRealtimeIndicators();
}

function applyDelta(delta = {}) {
  const tableMap = new Map(state.tables.map((table) => [table.id, table]));
  const orderMap = new Map(state.orders.map((order) => [order.id, order]));

  (delta.tables_upsert || []).forEach((table) => {
    tableMap.set(table.id, table);
  });
  (delta.tables_remove || []).forEach((tableId) => {
    tableMap.delete(tableId);
  });

  (delta.orders_upsert || []).forEach((order) => {
    orderMap.set(order.id, order);
  });
  (delta.orders_remove || []).forEach((orderId) => {
    orderMap.delete(orderId);
  });

  state = {
    tables: [...tableMap.values()],
    orders: [...orderMap.values()],
  };
  serviceMode = delta.service_mode || serviceMode;
  version = delta.version || version;
  refreshRealtimeIndicators();
}

function refreshRealtimeIndicators() {
  const pendingNow = new Set(state.tables.filter((table) => table.status === 'pending_order').map((table) => table.id));
  const checkoutNow = new Set(state.tables.filter((table) => table.call_staff_status === 'requested').map((table) => table.id));
  const hasNewPending = [...pendingNow].some((id) => !lastPendingIds.has(id));
  const hasNewCheckout = [...checkoutNow].some((id) => !lastCheckoutIds.has(id));
  if (hasNewPending) playNewOrderSound();
  if (hasNewCheckout) {
    playCheckoutSound();
    playCallStaffAlertBurst(5000);
  }
  checkoutNow.forEach((tableId) => {
    if (!lastCheckoutIds.has(tableId)) blinkTableCard(tableId);
  });
  lastPendingIds = pendingNow;
  lastCheckoutIds = checkoutNow;
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
  }, 3500);
  blinkTimers.set(tableId, timeoutId);
}

(function init() {
  authState = loadAuthState();
  updateAuthUI();
  bindTabs();
  document.getElementById('staff-logout-btn').addEventListener('click', () => {
    localStorage.removeItem(USER_ROLE_KEY);
    authState = null;
    updateAuthUI();
  });
  window.addEventListener('online', updateAuthUI);
  window.addEventListener('offline', updateAuthUI);
  if (authState) loadLive();
})();
