const HEARTBEAT_MS = 3000;
const FETCH_TIMEOUT_MS = 1800;
let syncTimer = null;
let syncInFlight = false;

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pingMaster(masterBaseUrl) {
  try {
    const response = await fetchWithTimeout(`${masterBaseUrl}/api/ping`, { method: 'GET', cache: 'no-store' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function flushPendingOrders(masterBaseUrl) {
  const pendingOrders = await window.posDB.getPendingOrders();
  if (!pendingOrders.length) return { pushed: 0, cleared: 0 };

  const response = await fetchWithTimeout(`${masterBaseUrl}/api/sync/pending-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_orders: pendingOrders }),
  });

  if (!response.ok) {
    return { pushed: 0, cleared: 0 };
  }

  const result = await response.json();
  const accepted = Array.isArray(result.accepted) ? result.accepted : [];
  const acceptedOrderIds = accepted
    .map((item) => item.client_order_id || item.pending_id)
    .filter(Boolean);

  if (acceptedOrderIds.length) {
    await window.posDB.removePendingOrders(acceptedOrderIds);
  }

  return { pushed: pendingOrders.length, cleared: acceptedOrderIds.length };
}

async function syncHeartbeat(masterBaseUrl) {
  if (syncInFlight) return { onlineLan: true, pushed: 0, cleared: 0, skipped: true };
  syncInFlight = true;
  try {
    const onlineLan = await pingMaster(masterBaseUrl);
    if (!onlineLan) return { onlineLan: false, pushed: 0, cleared: 0 };

    const flushResult = await flushPendingOrders(masterBaseUrl);
    return { onlineLan: true, ...flushResult };
  } finally {
    syncInFlight = false;
  }
}

function startSync(masterBaseUrl) {
  if (!masterBaseUrl) return;
  if (syncTimer) clearInterval(syncTimer);

  syncHeartbeat(masterBaseUrl).catch(() => {});
  syncTimer = setInterval(() => {
    syncHeartbeat(masterBaseUrl).catch(() => {});
  }, HEARTBEAT_MS);
}

window.posSync = {
  startSync,
  syncHeartbeat,
};
