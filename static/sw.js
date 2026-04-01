const SW_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `fakdu-pos-shell-${SW_VERSION}`;
const OFFLINE_ASSETS = [
  '/',
  '/staff',
  '/manifest.webmanifest',
  `/static/style.css?v=${encodeURIComponent(SW_VERSION)}`,
  `/static/app.js?v=${encodeURIComponent(SW_VERSION)}`,
  `/static/customer.js?v=${encodeURIComponent(SW_VERSION)}`,
  `/static/db.js?v=${encodeURIComponent(SW_VERSION)}`,
  `/static/sync.js?v=${encodeURIComponent(SW_VERSION)}`,
  `/static/staff.js?v=${encodeURIComponent(SW_VERSION)}`,
  '/static/sounds/new_order.mp3',
  '/static/sounds/checkout.mp3',
  '/static/sounds/warning.mp3',
];

function isHttpRequest(request) {
  return request.url.startsWith('http://') || request.url.startsWith('https://');
}

function isApiRequest(request) {
  return new URL(request.url).pathname.startsWith('/api/');
}

function isCacheableStatic(request) {
  if (request.method !== 'GET') return false;
  if (!isHttpRequest(request)) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith('/static/') || url.pathname === '/' || url.pathname === '/staff' || url.pathname === '/manifest.webmanifest';
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !isHttpRequest(request)) return;

  if (isApiRequest(request)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match('/') || Response.error())
    );
    return;
  }

  if (!isCacheableStatic(request)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || networkFetch;
    })
  );
});
