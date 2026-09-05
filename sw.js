const CACHE_NAME = 'stock-tracker-v6';
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
  // NOTE: deliberately NOT calling skipWaiting() here. Letting the new worker sit in "waiting"
  // is what allows the page to detect it and prompt "new version available" — with automatic
  // skipWaiting the swap happened invisibly and the user never learned an update existed.
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

// The page sends this after the user accepts the update prompt.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // API calls always go to network — never cached.
  if (req.url.includes('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // HTML/navigation requests: NETWORK FIRST. This is the fix for "deploys don't show up" —
  // previously index.html was served cache-first, so a new deploy stayed invisible until the
  // user manually cleared site data. Falls back to cache when offline.
  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Everything else (icons, CDN scripts): cache first, since those are versioned or static.
  event.respondWith(
    caches.match(req).then(response => response || fetch(req))
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
