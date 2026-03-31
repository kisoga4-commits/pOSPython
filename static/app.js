let db = null;
let currentTable = null;
let cart = [];
let version = 0;
let pendingSeen = new Set();
let menuEditIndex = -1;
let pendingMenuImageData = '';
let isAdminAuthenticated = false;

const TABLE_STATUS_META = {
  available: { label: 'ว่าง', className: 'status-available' },
  pending_order: { label: 'รอพนักงานรับ', className: 'status-pending_order' },
  accepted_order: { label: 'รับออร์เดอร์แล้ว', className: 'status-accepted_order' },
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

function showScreen(id) {
  document.querySelectorAll('main .screen').forEach((el) => {
    if (el.id) el.classList.add('hidden');
  });
  const node = document.getElementById(id);
  if (node) node.classList.remove('hidden');
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.screen === id);
  });
}

function bindNav() {
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });
  showScreen('customer');
}

function bindKitchenSubtabs() {
  document.querySelectorAll('[data-subtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.subtab;
      document.querySelectorAll('[data-subtab]').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.getElementById('subtab-sales').classList.toggle('hidden', target !== 'sales');
      document.getElementById('subtab-manage').classList.toggle('hidden', target !== 'manage');
    });
  });
}

function mountQRCode(el, text) {
  if (!el) return;
  el.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(el, {
      text,
      width: 118,
      height: 118,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  } else {
    const fallback = document.createElement('a');
    fallback.href = text;
    fallback.target = '_blank';
    fallback.textContent = text;
    el.appendChild(fallback);
  }
}

function renderLinks() {
  const base = window.location.origin;
  const staff = `${base}/scan/staff`;
  const staffNode = document.getElementById('staff-link');
  staffNode.href = staff;
  staffNode.textContent = staff;

  const customerNode = document.getElementById('customer-link');
  customerNode.href = `${base}/scan/customer/1`;
  customerNode.textContent = `${base}/scan/customer/{table_id}`;

  const staffScanLink = document.getElementById('staff-scan-link');
  if (staffScanLink) {
    staffScanLink.href = staff;
    staffScanLink.textContent = staff;
  }
  mountQRCode(document.getElementById('staff-qr-box'), staff);

  const wrap = document.getElementById('customer-qr-links');
  const qrGrid = document.getElementById('customer-qr-grid');
  wrap.innerHTML = '';
  if (qrGrid) qrGrid.innerHTML = '';

  db.tables.forEach((table) => {
    const tableUrl = `${base}/scan/customer/${table.id}`;

    const link = document.createElement('a');
    link.href = tableUrl;
    link.target = '_blank';
    link.textContent = `โต๊ะ ${table.id}`;
    link.className = 'badge';
    wrap.appendChild(link);

    if (qrGrid) {
      const card = document.createElement('div');
      card.className = 'table-qr-card';
      card.innerHTML = `<div class="qr-table-title">โต๊ะ ${table.id}</div><div class="qr-inline"></div><a class="qr-inline-link" target="_blank"></a>`;
      const qrMount = card.querySelector('.qr-inline');
      const qrLink = card.querySelector('.qr-inline-link');
      qrLink.href = tableUrl;
      qrLink.textContent = `/scan/customer/${table.id}`;
      mountQRCode(qrMount, tableUrl);
      qrGrid.appendChild(card);
    }
  });
}

function renderTables() {
  const grid = document.getElementById('table-grid');
  grid.innerHTML = '';
  db.tables.forEach((table) => {
    const meta = getStatusMeta(table.status);
    const btn = document.createElement('button');
    btn.className = `table-card ${meta.className}`;
    btn.innerHTML = `<p class="table-id">โต๊ะ ${table.id}</p><span class="status-badge table-status ${meta.className}">${meta.label}</span>`;

    if (table.status === 'pending_order') {
      const dot = document.createElement('span');
      dot.className = 'dot-notify';
      dot.textContent = '● ใหม่';
      btn.appendChild(dot);
    }

    btn.addEventListener('click', () => {
      currentTable = table.id;
      cart = [];
      document.getElementById('active-table').textContent = String(table.id);
      document.getElementById('menu-area').classList.remove('hidden');
      renderMenu();
      renderCart();
    });
    grid.appendChild(btn);
  });
}

function renderMenu() {
  const list = document.getElementById('menu-list');
  const preview = document.getElementById('menu-preview');
  list.innerHTML = '';
  if (preview) preview.innerHTML = '';

  db.menu.forEach((m) => {
    const btn = document.createElement('button');
    btn.innerHTML = `${m.image ? `<img src="${m.image}" class="menu-thumb" alt="${m.name}" />` : ''}<span>${m.name} - ${m.price}</span>`;
    btn.addEventListener('click', () => {
      cart.push(m);
      renderCart();
    });
    list.appendChild(btn);

    if (preview) {
      const chip = document.createElement('div');
      chip.className = 'menu-chip';
      chip.innerHTML = `<span class="badge">${m.name} · ${m.price}</span>`;
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-secondary menu-chip-btn';
      editBtn.type = 'button';
      editBtn.textContent = 'แก้ไข';
      editBtn.addEventListener('click', () => {
        menuEditIndex = db.menu.findIndex((item) => item.name === m.name && Number(item.price) === Number(m.price));
        document.getElementById('menu-name').value = m.name;
        document.getElementById('menu-price').value = m.price;
        pendingMenuImageData = m.image || '';
        document.getElementById('save-menu-item').textContent = 'บันทึกการแก้ไข';
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-secondary menu-chip-btn danger';
      delBtn.type = 'button';
      delBtn.textContent = 'ลบ';
      delBtn.addEventListener('click', async () => {
        db.menu = db.menu.filter((_, idx) => idx !== db.menu.findIndex((item) => item.name === m.name && Number(item.price) === Number(m.price)));
        await saveMenuItems();
      });
      chip.appendChild(editBtn);
      chip.appendChild(delBtn);
      preview.appendChild(chip);
    }
  });
}

function renderCart() {
  const list = document.getElementById('cart-list');
  list.innerHTML = '';
  const total = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);

  if (!cart.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'ยังไม่มีรายการในบิลนี้';
    list.appendChild(empty);
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

function renderCashier() {
  const list = document.getElementById('checkout-list');
  const count = document.getElementById('checkout-count');
  list.innerHTML = '';

  const checkoutTables = db.tables.filter((table) => table.status === 'checkout_requested');
  count.textContent = `${checkoutTables.length} รายการ`;

  if (!checkoutTables.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '🧾 ยังไม่มีคิวเช็คบิล';
    list.appendChild(empty);
    return;
  }

  checkoutTables.forEach((table) => {
    const tableOrders = db.orders.filter((o) => o.target === 'table' && o.target_id === table.id);
    const items = tableOrders.flatMap((o) => o.items || []);
    const total = items.reduce((sum, i) => sum + Number(i.price || 0), 0);
    const btn = document.createElement('button');
    btn.className = 'list-item checkout-item';
    btn.innerHTML = `<strong>โต๊ะ ${table.id}</strong><div>ยอดรวม ${total}</div><div class="btn-row"><button class="btn-secondary pay-btn" data-method="cash">💵</button><button class="btn-secondary pay-btn" data-method="qr">📱</button></div>`;
    btn.querySelectorAll('.pay-btn').forEach((payBtn) => {
      payBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await api('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({ target: 'table', target_id: table.id, payment_method: payBtn.dataset.method }),
        });
        await loadData();
      });
    });
    list.appendChild(btn);
  });
}

function renderOrders() {
  const list = document.getElementById('all-orders');
  list.innerHTML = '';
  db.orders.slice().reverse().forEach((order) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.textContent = `${order.id} | ${order.target} ${order.target_id} | ${order.status} | ${order.items.length} รายการ`;
    list.appendChild(row);
  });
}

function renderReport() {
  const total = db.sales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  document.getElementById('sales-total').textContent = String(total);
  document.getElementById('sale-today').textContent = String(total);
  document.getElementById('sale-week').textContent = String(total);
  document.getElementById('sale-month').textContent = String(total);
  document.getElementById('cash-total').textContent = String(total);
  document.getElementById('qr-total').textContent = '0';

  const list = document.getElementById('sales-list');
  list.innerHTML = '';

  if (!db.sales.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'ยังไม่มีประวัติการขาย';
    list.appendChild(empty);
    return;
  }

  db.sales.slice().reverse().forEach((sale) => {
    const paymentSymbol = sale.payment_method === 'qr' ? '📱' : '💵';
    const row = document.createElement('div');
    row.className = 'list-item';
    row.textContent = `${sale.id} | ${sale.target} ${sale.target_id} | ${paymentSymbol} ${sale.total}`;
    list.appendChild(row);
  });
}

function renderSettings() {
  document.getElementById('table-count').value = db.tableCount;
  const settings = db.settings || {};
  document.getElementById('store-name').value = settings.storeName || 'FAKDU';
  document.getElementById('store-phone').value = settings.storePhone || '';
  document.getElementById('store-address').value = settings.storeAddress || '';
  document.getElementById('store-currency').value = settings.currency || 'บาท (฿)';
  document.getElementById('store-promptpay').value = settings.promptPay || '';
  document.getElementById('admin-pin').value = settings.adminPin || '2468';
  document.getElementById('store-tax-rate').value = Number(settings.taxRate || 0);
  document.getElementById('store-service-rate').value = Number(settings.serviceRate || 0);
  document.getElementById('store-receipt-note').value = settings.receiptNote || '';
  document.getElementById('system-save-state').textContent = 'พร้อมแก้ไข';
}

function getSystemPayload() {
  return {
    storeName: document.getElementById('store-name').value.trim(),
    storePhone: document.getElementById('store-phone').value.trim(),
    storeAddress: document.getElementById('store-address').value.trim(),
    currency: document.getElementById('store-currency').value.trim(),
    promptPay: document.getElementById('store-promptpay').value.trim(),
    adminPin: document.getElementById('admin-pin').value.trim() || '2468',
    taxRate: Number(document.getElementById('store-tax-rate').value || 0),
    serviceRate: Number(document.getElementById('store-service-rate').value || 0),
    receiptNote: document.getElementById('store-receipt-note').value.trim(),
  };
}

async function saveMenuItems() {
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ menu: db.menu }) });
  menuEditIndex = -1;
  document.getElementById('menu-name').value = '';
  document.getElementById('menu-price').value = '';
  document.getElementById('menu-image').value = '';
  pendingMenuImageData = '';
  document.getElementById('save-menu-item').textContent = 'เพิ่มรายการ';
  await loadData();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function enforceAdminScreens() {
  const protectedScreens = ['kitchen', 'settings'];
  if (!isAdminAuthenticated && protectedScreens.includes(document.querySelector('.main-tab.is-active')?.dataset.screen)) {
    showScreen('customer');
  }
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    const isProtected = protectedScreens.includes(btn.dataset.screen);
    btn.disabled = isProtected && !isAdminAuthenticated;
    btn.title = btn.disabled ? 'ต้อง login admin ก่อน' : '';
  });
  document.getElementById('admin-login-btn').classList.toggle('hidden', isAdminAuthenticated);
  document.getElementById('admin-logout-btn').classList.toggle('hidden', !isAdminAuthenticated);
}

function playPendingAlertIfNeeded() {
  const currentPending = new Set(db.tables.filter((table) => table.status === 'pending_order').map((table) => table.id));
  const hasNewPending = [...currentPending].some((id) => !pendingSeen.has(id));
  if (hasNewPending) {
    const audio = document.getElementById('new-order-sound');
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }
  pendingSeen = currentPending;
}

async function loadData() {
  const data = await api('/api/data');
  if (data.error) return;
  db = data;
  version = db.meta.version;
  playPendingAlertIfNeeded();
  renderLinks();
  renderTables();
  renderMenu();
  renderCashier();
  renderOrders();
  renderReport();
  renderSettings();
  enforceAdminScreens();
}

async function pollLive() {
  const data = await api(`/api/staff/live?since=${version}`);
  if (data.changed) {
    await loadData();
  }
}

function bindActions() {
  document.getElementById('submit-order').addEventListener('click', async () => {
    if (!currentTable || !cart.length) return;
    await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({ target: 'table', target_id: currentTable, cart, source: 'host' }),
    });
    cart = [];
    document.getElementById('menu-area').classList.add('hidden');
    await loadData();
  });


  document.getElementById('quick-table-down').addEventListener('click', async () => {
    const next = Math.max(1, Number(document.getElementById('table-count').value || db.tableCount || 1) - 1);
    document.getElementById('table-count').value = next;
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount: next }) });
    await loadData();
  });

  document.getElementById('quick-table-mid').addEventListener('click', async () => {
    const next = Math.max(1, Number(document.getElementById('table-count').value || db.tableCount || 8));
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount: next }) });
    await loadData();
  });

  document.getElementById('quick-table-up').addEventListener('click', async () => {
    const next = Number(document.getElementById('table-count').value || db.tableCount || 8) + 1;
    document.getElementById('table-count').value = next;
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount: next }) });
    await loadData();
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    const tableCount = Number(document.getElementById('table-count').value || 8);
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ tableCount }) });
    await loadData();
  });

  document.getElementById('reset-day').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ reset: true }) });
    await loadData();
  });

  document.getElementById('save-system-settings').addEventListener('click', async () => {
    document.getElementById('system-save-state').textContent = 'กำลังบันทึก...';
    const payload = getSystemPayload();
    const logoInput = document.getElementById('store-logo');
    if (logoInput && logoInput.files && logoInput.files[0]) payload.logoName = logoInput.files[0].name;
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: payload }) });
    document.getElementById('system-save-state').textContent = 'บันทึกแล้ว';
    await loadData();
  });

  document.getElementById('reset-system-settings').addEventListener('click', async () => {
    const defaults = {
      storeName: 'FAKDU',
      storePhone: '',
      storeAddress: '',
      currency: 'บาท (฿)',
      promptPay: '',
      adminPin: '2468',
      taxRate: 0,
      serviceRate: 0,
      receiptNote: '',
    };
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: defaults }) });
    await loadData();
  });

  document.getElementById('save-menu-item').addEventListener('click', async () => {
    const name = document.getElementById('menu-name').value.trim();
    const price = Number(document.getElementById('menu-price').value || 0);
    if (!name || price <= 0) return;

    const imageFile = document.getElementById('menu-image').files?.[0];
    let image = pendingMenuImageData || '';
    if (imageFile) image = await fileToDataUrl(imageFile);

    if (menuEditIndex >= 0) {
      db.menu[menuEditIndex] = { ...db.menu[menuEditIndex], name, price, image };
    } else {
      db.menu.push({ name, price, image });
    }
    await saveMenuItems();
  });

  document.getElementById('add-menu-item').addEventListener('click', () => {
    menuEditIndex = -1;
    document.getElementById('menu-name').value = '';
    document.getElementById('menu-price').value = '';
    document.getElementById('menu-image').value = '';
    pendingMenuImageData = '';
    document.getElementById('menu-name').focus();
    document.getElementById('save-menu-item').textContent = 'เพิ่มรายการ';
  });

  document.getElementById('admin-login-btn').addEventListener('click', () => {
    const enteredPin = window.prompt('กรอกรหัส Admin');
    if (!enteredPin) return;
    const validPin = String((db.settings && db.settings.adminPin) || '2468');
    if (enteredPin === validPin) {
      isAdminAuthenticated = true;
      localStorage.setItem('fakdu_admin_auth', '1');
      enforceAdminScreens();
    } else {
      window.alert('รหัสไม่ถูกต้อง');
    }
  });

  document.getElementById('admin-logout-btn').addEventListener('click', () => {
    isAdminAuthenticated = false;
    localStorage.removeItem('fakdu_admin_auth');
    enforceAdminScreens();
  });

  document.getElementById('export-data').addEventListener('click', () => {
    if (!db) return;
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-data').addEventListener('click', async () => {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!imported || !Array.isArray(imported.menu) || !Array.isArray(imported.tables)) return;
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        tableCount: Number(imported.tableCount || 8),
        menu: imported.menu,
        settings: imported.settings || {},
      }),
    });
    await loadData();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const version = window.__ASSET_VERSION__ || Date.now().toString();
  navigator.serviceWorker.register(`/static/sw.js?v=${encodeURIComponent(version)}`).catch(() => {});
}

(function init() {
  bindNav();
  bindKitchenSubtabs();
  bindActions();
  registerServiceWorker();
  isAdminAuthenticated = localStorage.getItem('fakdu_admin_auth') === '1';
  enforceAdminScreens();
  loadData();
  setInterval(pollLive, 2000);
})();
