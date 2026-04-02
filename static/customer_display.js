function qs(id) {
  return document.getElementById(id);
}

function money(value) {
  return Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-POS-Role': 'owner', ...(options.headers || {}) },
    cache: 'no-store',
    ...options,
  });
  return response.json();
}

function buildPromptPayPayload(promptPayId, amount = 0, dynamic = true) {
  return window.PromptPayQR?.buildPromptPayPayload(promptPayId, amount, dynamic) || '';
}

function buildQrImageUrl(rawText) {
  return window.PromptPayQR?.buildQrImageUrl(rawText) || '';
}

function buildPromptPayQrImage(promptPayId, amount, dynamic) {
  const payload = buildPromptPayPayload(promptPayId, amount, dynamic);
  if (!payload) return '';
  return buildQrImageUrl(payload);
}

function resolvePaymentQrImage(cfg, amount) {
  const settings = cfg || {};
  const promptPayId = String(settings.promptPay || '').trim();
  const hasUploadedQrImage = Boolean(String(settings.qrImage || '').trim());
  if (settings.dynamicPromptPay && promptPayId) {
    return buildPromptPayQrImage(settings.promptPay || '', Number(amount || 0), true);
  }
  if (hasUploadedQrImage) return settings.qrImage;
  return buildPromptPayQrImage(promptPayId, Number(amount || 0), false);
}

function renderPaymentQrImage(imageUrl) {
  const qrWrap = qs('customer-facing-qr-wrap');
  const qrImage = qs('customer-facing-qr-image');
  const qrNote = qs('customer-facing-qr-note');
  const safeImageUrl = String(imageUrl || '').trim();
  if (!safeImageUrl) {
    qrImage?.removeAttribute('src');
    qrWrap?.classList.add('hidden');
    if (qrNote) {
      qrNote.textContent = 'ไม่มี QR ชำระเงิน (ร้านยังไม่ได้ตั้งค่าพร้อมเพย์หรือรูป QR)';
      qrNote.classList.remove('hidden');
    }
    return;
  }
  qrWrap?.classList.remove('hidden');
  qrImage.src = safeImageUrl;
  if (qrNote) {
    qrNote.textContent = '';
    qrNote.classList.add('hidden');
  }
}

function summarizeItems(items = []) {
  const itemMap = new Map();
  items.forEach((item) => {
    const key = `${item.name}|${item.addon || ''}|${item.note || ''}|${Number(item.price || 0)}`;
    if (!itemMap.has(key)) itemMap.set(key, { ...item, qty: 0 });
    const entry = itemMap.get(key);
    entry.qty += Math.max(1, Number(item.qty || 1));
  });
  return Array.from(itemMap.values());
}

function getAdaptiveGridSize(count) {
  const total = Math.max(0, Number(count || 0));
  if (total <= 3) return 3;
  if (total <= 9) return 3;
  return 4;
}

const ACTIVE_TABLE_KEY = 'customer_display_active_table';
let settings = {};
let tableId = Number(document.body.dataset.tableId || localStorage.getItem(ACTIVE_TABLE_KEY) || 0);
let liveEventSource = null;
let syncedTableId = 0;

async function loadSettings() {
  const data = await api('/api/data');
  settings = data.settings || {};
}

function updateTableHeader() {
  qs('customer-facing-table').textContent = tableId > 0 ? tableId : '-';
  const note = qs('customer-facing-mode-note');
  if (!note) return;
  note.textContent = tableId > 0
    ? 'หน้าจอลูกค้า (Customer View) · อัปเดตอัตโนมัติ'
    : 'หน้าจอลูกค้า (Customer View) · รอเลือกโต๊ะจากเครื่องหลัก';
}

function renderBill(bill) {
  const list = qs('customer-facing-items');
  const qrWrap = qs('customer-facing-qr-wrap');
  list.innerHTML = '';
  const groupedItems = summarizeItems(bill.items || []);
  list.dataset.gridSize = String(getAdaptiveGridSize(groupedItems.length));
  if (!groupedItems.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการที่ต้องชำระ<br/>รอการเช็คบิลถัดไป</div>';
    qs('customer-facing-total').textContent = money(0);
    qs('customer-facing-qr-image').removeAttribute('src');
    qrWrap?.classList.add('hidden');
    return;
  }

  groupedItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-card bill-row-item';
    const qty = Math.max(1, Number(item.qty || 1));
    const thumb = item.image ? `<img src="${item.image}" alt="${item.name}" class="checkout-item-thumb" />` : '<span class="checkout-item-thumb fallback">🍽️</span>';
    row.innerHTML = `${thumb}<strong>${item.name}${qty > 1 ? ` x${qty}` : ''}</strong><span>฿${money(item.price * qty)}</span>`;
    list.appendChild(row);
  });
  qs('customer-facing-total').textContent = money(bill.total);
  const qrImage = resolvePaymentQrImage(settings, Number(bill.total || 0));
  renderPaymentQrImage(qrImage);
}

function renderWaitingDisplay() {
  const list = qs('customer-facing-items');
  const qrWrap = qs('customer-facing-qr-wrap');
  const qrNote = qs('customer-facing-qr-note');
  list.innerHTML = '<div class="empty">หน้าจอพร้อมใช้งาน<br/>รอการเช็คบิลถัดไป</div>';
  qs('customer-facing-total').textContent = money(0);
  qs('customer-facing-qr-image').removeAttribute('src');
  qrWrap?.classList.add('hidden');
  qrNote?.classList.add('hidden');
  if (qrNote) qrNote.textContent = '';
}

function clearDisplaySelection() {
  tableId = 0;
  localStorage.setItem(ACTIVE_TABLE_KEY, '0');
  updateTableHeader();
  renderWaitingDisplay();
}

async function refreshBill() {
  await loadSettings();
  try {
    const remote = await api('/api/customer-display/active');
    const remoteTableId = Number(remote.table_id || 0);
    if (remoteTableId !== syncedTableId) {
      syncedTableId = remoteTableId;
      if (remoteTableId > 0 || !document.body.dataset.tableId) {
        tableId = remoteTableId;
        localStorage.setItem(ACTIVE_TABLE_KEY, String(remoteTableId));
      }
    }
  } catch (error) {
    // fallback to local storage when active-table sync endpoint is unavailable
  }
  if (!tableId) {
    updateTableHeader();
    renderWaitingDisplay();
    return;
  }
  const bill = await api(`/api/bill/table/${tableId}`);
  if (bill.error) return;
  updateTableHeader();
  renderBill(bill);
}

function connectLiveEvents() {
  if (liveEventSource || !window.EventSource) return;
  liveEventSource = new EventSource('/api/events');
  liveEventSource.addEventListener('update', () => refreshBill());
  liveEventSource.onerror = () => {
    if (liveEventSource) liveEventSource.close();
    liveEventSource = null;
    setTimeout(connectLiveEvents, 2500);
  };
}

function bindAutoTableSync() {
  window.addEventListener('storage', (event) => {
    if (event.key !== ACTIVE_TABLE_KEY) return;
    const next = Number(event.newValue || 0);
    if (next > 0) {
      tableId = next;
      refreshBill();
      return;
    }
    clearDisplaySelection();
  });
}

async function init() {
  await loadSettings();
  bindAutoTableSync();
  updateTableHeader();
  await refreshBill();
  connectLiveEvents();
}

init();
