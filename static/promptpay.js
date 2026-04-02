(function attachPromptPayQR(global) {
  function tlv(id, value) {
    const val = String(value ?? '');
    return `${id}${String(val.length).padStart(2, '0')}${val}`;
  }

  function sanitizePromptPay(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return { type: '', value: '' };
    if (digits.length === 13) return { type: 'tax_id', value: digits };
    if (digits.length === 10 && digits.startsWith('0')) return { type: 'mobile', value: `0066${digits.slice(1)}` };
    if (digits.length === 9) return { type: 'mobile', value: `0066${digits}` };
    if (digits.length === 11 && digits.startsWith('66')) return { type: 'mobile', value: `0066${digits.slice(2)}` };
    return { type: '', value: '' };
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

  function formatAmount(amount) {
    const safe = Number(amount || 0);
    if (!Number.isFinite(safe) || safe <= 0) return '';
    return safe.toFixed(2);
  }

  function buildPromptPayPayload(promptPayId, amount = 0, dynamic = true) {
    const normalized = sanitizePromptPay(promptPayId);
    if (!normalized.value) return '';
    const proxyId = normalized.type === 'tax_id' ? '02' : '01';
    const merchantInfo = `${tlv('00', 'A000000677010111')}${tlv(proxyId, normalized.value)}`;
    let payload = '';
    payload += tlv('00', '01');
    payload += tlv('01', dynamic ? '12' : '11');
    payload += tlv('29', merchantInfo);
    payload += tlv('52', '0000');
    payload += tlv('53', '764');
    payload += tlv('58', 'TH');
    const amountText = dynamic ? formatAmount(amount) : '';
    if (amountText) payload += tlv('54', amountText);
    payload += tlv('63', '');
    return payload + crc16ccitt(payload);
  }

  function buildQrImageUrl(text) {
    const value = String(text || '').trim() || 'promptpay-not-configured';
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(value)}`;
  }

  global.PromptPayQR = {
    sanitizePromptPay,
    buildPromptPayPayload,
    buildQrImageUrl,
  };
}(window));
