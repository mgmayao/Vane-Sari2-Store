// Network-first: always tries the latest version, falls back to cache when offline.
const CACHE = 'vane-pos-v6';
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; }
  catch (err) { payload = {body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(clients => {
    if (clients.some(client => client.visibilityState === 'visible')) return;
    return self.registration.showNotification(payload.title || 'Vane POS bill reminder', {
      body: payload.body || 'You have an unpaid bill due. Open Vane POS to view your reminder.',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: payload.tag || 'utang-bill-reminder',
      data: {url: './'}
    });
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(clients => {
    const existing = clients.find(client => client.url === target || client.url.startsWith(self.location.origin));
    return existing ? existing.focus() : self.clients.openWindow(target);
  }));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || (url.origin !== location.origin && !CDN.includes(url.hostname))) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (url.origin === location.origin ? caches.match('index.html') : Response.error())))
  );
});
