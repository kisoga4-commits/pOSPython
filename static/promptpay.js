(function attachPromptPayQR(global) {
  const qrImageCache = new Map();
  function tlv(id, value) {
    const val = String(value ?? '');
    return `${id}${String(val.length).padStart(2, '0')}${val}`;
  }

  function sanitizePromptPay(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return { type: '', value: '' };

    // Thai mobile (0XXXXXXXXX)
    if (digits.length === 10 && digits.startsWith('0')) {
      return { type: 'mobile', value: `0066${digits.slice(1)}` };
    }

    // Thai mobile in country-code format (66XXXXXXXXX)
    if (digits.length === 11 && digits.startsWith('66')) {
      return { type: 'mobile', value: `0066${digits.slice(2)}` };
    }

    // Already-normalized PromptPay mobile (0066XXXXXXXXX)
    if (digits.length === 13 && digits.startsWith('0066')) {
      return { type: 'mobile', value: digits };
    }

    // Thai national ID / tax ID
    if (digits.length === 13) {
      return { type: 'tax_id', value: digits };
    }

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
    const crcBase = `${payload}6304`;
    return crcBase + crc16ccitt(crcBase);
  }

  function buildQrImageUrl(text) {
    const value = String(text || '').trim();
    if (!value) return '';
    if (qrImageCache.has(value)) return qrImageCache.get(value);

    // Higher error correction + margin makes physical scanning easier on phone cameras.
    const imageUrl = `https://quickchart.io/qr?size=512&margin=2&ecLevel=Q&format=png&text=${encodeURIComponent(value)}`;
    qrImageCache.set(value, imageUrl);
    return imageUrl;
  }

  global.PromptPayQR = {
    sanitizePromptPay,
    buildPromptPayPayload,
    buildQrImageUrl,
  };
}(window));
