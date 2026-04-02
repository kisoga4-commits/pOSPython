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

function sanitizePromptPay(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 11 && digits.startsWith('66')) return `0${digits.slice(2)}`;
  if (digits.length === 13) return digits;
  return digits;
}

function crc16ccitt(input) {
  let crc = 0xFFFF;
  for (let c = 0; c < input.length; c += 1) {
    crc ^= input.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id, value) {
  const val = String(value);
  return `${id}${String(val.length).padStart(2, '0')}${val}`;
}

function buildPromptPayPayload(promptPayId, amount = 0, dynamic = true) {
  const id = sanitizePromptPay(promptPayId);
  if (!id) return '';
  const formattedId = id.length === 10 && id.startsWith('0') ? `0066${id.slice(1)}` : id;
  const merchantInfo = `${tlv('00', 'A000000677010111')}${tlv('01', formattedId)}`;
  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('01', dynamic ? '12' : '11');
  payload += tlv('29', merchantInfo);
  payload += tlv('52', '0000');
  payload += tlv('58', 'TH');
  payload += tlv('53', '764');
  if (dynamic && amount > 0) payload += tlv('54', Number(amount).toFixed(2));
  payload += tlv('63', '');
  return payload + crc16ccitt(payload);
}

function buildQrImageUrl(rawText) {
  const text = String(rawText || '').trim();
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(text || 'promptpay-not-configured')}`;
}

function buildPromptPayQrImage(promptPayId, amount, dynamic) {
  const payload = buildPromptPayPayload(promptPayId, amount, dynamic);
  if (!payload) return buildQrImageUrl('promptpay-not-configured');
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

  qrWrap?.classList.remove('hidden');
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
  qs('customer-facing-qr-image').src = qrImage;
}

function renderWaitingDisplay() {
  const list = qs('customer-facing-items');
  const qrWrap = qs('customer-facing-qr-wrap');
  list.innerHTML = '<div class="empty">หน้าจอพร้อมใช้งาน<br/>รอการเช็คบิลถัดไป</div>';
  qs('customer-facing-total').textContent = money(0);
  qs('customer-facing-qr-image').removeAttribute('src');
  qrWrap?.classList.add('hidden');
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
