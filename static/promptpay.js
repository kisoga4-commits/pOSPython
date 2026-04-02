(function attachPromptPayQR(global) {
  function sanitizePromptPay(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return { type: '', value: '' };

    if (digits.length === 13) return { type: 'tax_id', value: digits };

    if (digits.length === 10 && digits.startsWith('0')) {
      return { type: 'mobile', value: digits };
    }

    if (digits.length === 9) {
      return { type: 'mobile', value: `0${digits}` };
    }

    if (digits.length === 11 && digits.startsWith('66')) {
      return { type: 'mobile', value: `0${digits.slice(2)}` };
    }

    return { type: '', value: '' };
  }

  function formatAmount(amount) {
    const safe = Number(amount || 0);
    if (!Number.isFinite(safe) || safe <= 0) return '';
    return safe.toFixed(2);
  }

  function buildPromptPayIoUrl(promptPayId, amount = 0, dynamic = true) {
    const normalized = sanitizePromptPay(promptPayId);
    if (!normalized.value) return '';

    const baseUrl = `https://promptpay.io/${encodeURIComponent(normalized.value)}`;
    if (!dynamic) return `${baseUrl}.png`;

    const amountText = formatAmount(amount);
    if (!amountText) return '';

    return `${baseUrl}/${encodeURIComponent(amountText)}.png`;
  }

  function buildQrImageUrl(text) {
    const value = String(text || '').trim() || 'promptpay-not-configured';
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(value)}`;
  }

  global.PromptPayQR = {
    sanitizePromptPay,
    formatAmount,
    buildPromptPayIoUrl,
    buildQrImageUrl,
  };
}(window));
