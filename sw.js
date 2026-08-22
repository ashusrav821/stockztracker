const CACHE_NAME = 'stock-tracker-v4';
const urlsToCache = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Promise.allSettled instead of cache.addAll: addAll is all-or-nothing, so a single
      // missing/404 asset (e.g. an icon not yet deployed) would silently fail the ENTIRE
      // install — leaving the old service worker (without push handlers) in control. One
      // broken asset must never be able to block push notifications from working again.
      Promise.allSettled(
        urlsToCache.map(url => cache.add(url).catch(e => console.warn('SW precache failed for', url, e)))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Don't cache API calls to the worker (always go to network)
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// --- Push notifications (server-sent alerts, e.g. price-drop / RSI triggers) ---
// Runs even when the app/tab is closed — this is what lets an alert reach a
// paired watch via the phone's notification tray.
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Stock Alert', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Stock Alert';
  const options = {
    body: data.body || '',
    icon: data.icon || './icons/icon-192.png',
    badge: data.badge || './icons/icon-192.png',
    tag: data.tag,          // same-ticker alerts replace each other instead of stacking
    renotify: !!data.tag,
    data: { url: data.url || './' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(event.notification.data?.url || './');
    })
  );
});
