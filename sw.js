// Surge Partners HQ service worker — network first, cached shell as an offline fallback.
const CACHE = 'surge-hq-v2';
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

// ---- Appointment reminders (web push) ----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Surge', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Surge Partners', {
    body: d.body || '', tag: d.tag || 'surge', renotify: true,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    data: { url: d.url || '/agent' }, vibrate: [200, 100, 200]
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/agent';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.includes('/agent') && 'focus' in c) { c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
