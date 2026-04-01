const POS_IDB_NAME = 'pos-mobile-cache';
const POS_IDB_VERSION = 1;
const MENU_STORE = 'menu';
const PENDING_STORE = 'pendingOrders';

function openPosDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POS_IDB_NAME, POS_IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MENU_STORE)) {
        db.createObjectStore(MENU_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        const pending = db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
        pending.createIndex('status', 'status', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbTransaction(storeName, mode, operation) {
  const db = await openPosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    operation(store, resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

const posDB = {
  async saveMenu(menuItems = []) {
    await idbTransaction(MENU_STORE, 'readwrite', (store, resolve) => {
      store.clear();
      menuItems.forEach((item) => store.put(item));
      resolve(true);
    });
  },

  async loadMenu() {
    return idbTransaction(MENU_STORE, 'readonly', (store, resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async enqueuePendingOrder(orderPayload) {
    const payload = {
      ...orderPayload,
      id: orderPayload.client_order_id || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      status: 'pending',
      queued_at: new Date().toISOString(),
    };
    await idbTransaction(PENDING_STORE, 'readwrite', (store, resolve) => {
      store.put(payload);
      resolve(payload.id);
    });
    return payload.id;
  },

  async getPendingOrders() {
    return idbTransaction(PENDING_STORE, 'readonly', (store, resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((item) => item.status === 'pending'));
      };
      req.onerror = () => reject(req.error);
    });
  },

  async removePendingOrders(orderIds = []) {
    if (!orderIds.length) return;
    await idbTransaction(PENDING_STORE, 'readwrite', (store, resolve) => {
      orderIds.forEach((id) => store.delete(id));
      resolve(true);
    });
  },
};

window.posDB = posDB;
