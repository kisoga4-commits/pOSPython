const HEARTBEAT_MS = 3000;
let syncTimer = null;

async function pingMaster(masterBaseUrl) {
  try {
    const response = await fetch(`${masterBaseUrl}/api/ping`, { method: 'GET', cache: 'no-store' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function flushPendingOrders(masterBaseUrl) {
  const pendingOrders = await window.posDB.getPendingOrders();
  if (!pendingOrders.length) return { pushed: 0, cleared: 0 };

  const response = await fetch(`${masterBaseUrl}/api/sync/pending-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_orders: pendingOrders }),
  });

  if (!response.ok) {
    return { pushed: 0, cleared: 0 };
  }

  const result = await response.json();
  const accepted = Array.isArray(result.accepted) ? result.accepted : [];
  const acceptedClientIds = accepted
    .map((item) => item.client_order_id)
    .filter(Boolean);

  if (acceptedClientIds.length) {
    await window.posDB.removePendingOrders(acceptedClientIds);
  }

  return { pushed: pendingOrders.length, cleared: acceptedClientIds.length };
}

async function syncHeartbeat(masterBaseUrl) {
  const onlineLan = await pingMaster(masterBaseUrl);
  if (!onlineLan) return { onlineLan: false, pushed: 0, cleared: 0 };

  const flushResult = await flushPendingOrders(masterBaseUrl);
  return { onlineLan: true, ...flushResult };
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
