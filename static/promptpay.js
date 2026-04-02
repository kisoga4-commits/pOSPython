(function attachPromptPayQR(global) {
  const QR_DEFAULT_SIZE = 512;

  function tlv(id, value) {
    const val = String(value ?? '');
    return `${id}${String(val.length).padStart(2, '0')}${val}`;
  }

  function sanitizePromptPay(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return { type: '', value: '' };
    if (digits.length === 13 && digits.startsWith('0066')) return { type: 'mobile', value: digits };
    if (digits.length === 10 && digits.startsWith('0')) return { type: 'mobile', value: `0066${digits.slice(1)}` };
    if (digits.length === 9) return { type: 'mobile', value: `0066${digits}` };
    if (digits.length === 11 && digits.startsWith('66')) return { type: 'mobile', value: `0066${digits.slice(2)}` };
    if (digits.length === 13) return { type: 'tax_id', value: digits };
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

  function formatPromptPayIdForApi(raw) {
    const normalized = sanitizePromptPay(raw);
    if (!normalized.value) return '';
    if (normalized.type === 'tax_id') return normalized.value;
    if (normalized.type === 'mobile' && normalized.value.startsWith('0066') && normalized.value.length === 13) {
      return `0${normalized.value.slice(4)}`;
    }
    return '';
  }

  function buildPromptPayApiUrl(promptPayId, amount = 0) {
    const idText = formatPromptPayIdForApi(promptPayId);
    const amountText = formatAmount(amount);
    if (!idText || !amountText) return '';
    return `https://promptpay.io/${encodeURIComponent(idText)}/${encodeURIComponent(amountText)}.png`;
  }

  function buildPromptPayPayload(promptPayId, amount = 0, dynamic = true) {
    const normalized = sanitizePromptPay(promptPayId);
    if (!normalized.value) return '';
    const proxyId = normalized.type === 'tax_id' ? '02' : '01';
    const merchantInfo = `${tlv('00', 'A000000677010111')}${tlv(proxyId, normalized.value)}`;
    let payload = '';
    // EMVCo required fields
    payload += tlv('00', '01');
    payload += tlv('01', dynamic ? '12' : '11');
    payload += tlv('29', merchantInfo);
    payload += tlv('52', '0000');
    payload += tlv('53', '764');
    payload += tlv('58', 'TH');
    const amountText = dynamic ? formatAmount(amount) : '';
    if (amountText) payload += tlv('54', amountText);
    payload += '6304';
    return payload + crc16ccitt(payload);
  }

  function buildQrImageUrl(text, size = QR_DEFAULT_SIZE) {
    const value = String(text || '').trim() || 'promptpay-not-configured';
    const safeSize = Math.max(128, Number(size || QR_DEFAULT_SIZE));
    if (typeof global.QRCode === 'function') {
      const holder = document.createElement('div');
      holder.style.position = 'fixed';
      holder.style.left = '-99999px';
      holder.style.top = '-99999px';
      holder.style.width = `${safeSize}px`;
      holder.style.height = `${safeSize}px`;
      document.body.appendChild(holder);
      // eslint-disable-next-line no-new
      new global.QRCode(holder, {
        text: value,
        width: safeSize,
        height: safeSize,
        correctLevel: global.QRCode.CorrectLevel?.H || 2,
      });
      const canvas = holder.querySelector('canvas');
      const image = holder.querySelector('img');
      const result = canvas?.toDataURL('image/png') || image?.src || '';
      holder.remove();
      if (result) return result;
    }
    return `https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=12&ecc=H&data=${encodeURIComponent(value)}`;
  }

  global.PromptPayQR = {
    sanitizePromptPay,
    buildPromptPayPayload,
    buildQrImageUrl,
    buildPromptPayApiUrl,
  };
}(window));
