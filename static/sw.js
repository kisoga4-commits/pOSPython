const CACHE_NAME = 'fakdu-pos-shell-v6';
const OFFLINE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/static/style.css',
  '/static/app.js',
  '/static/customer.js',
  '/static/db.js',
  '/static/sync.js',
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
  return url.pathname.startsWith('/static/') || url.pathname === '/' || url.pathname === '/manifest.webmanifest';
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
