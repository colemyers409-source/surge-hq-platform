// Surge Partners HQ service worker — network first, cached shell as an offline fallback.
const CACHE = 'surge-hq-v1';
const SHELL = ['/', '/agent', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && req.mode === 'navigate') caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : undefined)))
  );
});
