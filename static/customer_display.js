function qs(id) {
  return document.getElementById(id);
}

function money(value) {
  return Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...options,
  });
  return response.json();
}

function sanitizePromptPay(raw) {
  return String(raw || '').replace(/\D/g, '');
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
  const merchantInfo = `0016A000000677010111${tlv('01', formattedId)}`;
  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('01', dynamic ? '12' : '11');
  payload += tlv('29', merchantInfo);
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

let settings = {};
let tableId = Number(document.body.dataset.tableId || 0);

async function loadSettings() {
  const data = await api('/api/data');
  settings = data.settings || {};
}

function renderBill(bill) {
  const list = qs('customer-facing-items');
  list.innerHTML = '';
  if (!bill.items?.length) {
    list.innerHTML = '<div class="empty">ยังไม่มีรายการค้างชำระ</div>';
  } else {
    bill.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'list-card bill-row-item';
      row.innerHTML = `<strong>${item.name} x${item.qty}</strong><span>฿${money(item.price * item.qty)}</span>`;
      list.appendChild(row);
    });
  }
  qs('customer-facing-total').textContent = money(bill.total);
  const qrImage = settings.qrImage || buildPromptPayQrImage(settings.promptPay || '', Number(bill.total || 0), Boolean(settings.dynamicPromptPay));
  qs('customer-facing-qr-image').src = qrImage;
}

async function refreshBill() {
  if (!tableId) return;
  const bill = await api(`/api/bill/table/${tableId}`);
  if (bill.error) return;
  renderBill(bill);
}

async function init() {
  await loadSettings();
  await refreshBill();
  setInterval(refreshBill, 2000);
}

init();
