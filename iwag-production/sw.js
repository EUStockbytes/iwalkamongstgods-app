// ── I WALK AMONGST GODS — Service Worker ──
// Version — update this to bust cache on new deployments
const CACHE_NAME = 'iwag-v1.0.0';
const OFFLINE_URL = '/index.html';

// Files to cache immediately on install
const PRECACHE_URLS = [
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap'
];

// ── INSTALL — cache core files ──
self.addEventListener('install', event => {
  console.log('[IWAG SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[IWAG SW] Pre-caching core files');
      return cache.addAll(PRECACHE_URLS).catch(err => {
        // Font CDN may fail in some environments — that's ok
        console.warn('[IWAG SW] Some pre-cache files failed:', err);
        return cache.add('/index.html');
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — clean up old caches ──
self.addEventListener('activate', event => {
  console.log('[IWAG SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[IWAG SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH — serve from cache, fall back to network ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Stripe and Anthropic API calls — always go to network
  if (
    url.hostname.includes('stripe.com') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('buy.stripe.com')
  ) {
    return;
  }

  // Cache-first for same-origin assets and fonts
  if (
    url.origin === self.location.origin ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          // Return cached version and update in background
          const networkFetch = fetch(request).then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
            }
            return response;
          }).catch(() => {});
          return cached;
        }

        // Not cached — fetch from network and cache it
        return fetch(request).then(response => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        }).catch(() => {
          // Offline fallback
          if (request.headers.get('accept').includes('text/html')) {
            return caches.match(OFFLINE_URL);
          }
        });
      })
    );
    return;
  }

  // Network-first for everything else
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'Your daily divine affirmation is ready ✦',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    vibrate: [200, 100, 200],
    tag: 'iwag-notification',
    renotify: true,
    data: { url: data.url || '/index.html' },
    actions: [
      { action: 'open', title: '✦ Open App', icon: '/icons/icon-72.png' },
      { action: 'dismiss', title: 'Later' }
    ]
  };
  event.waitUntil(
    self.registration.showNotification(
      data.title || 'I Walk Amongst Gods ✦',
      options
    )
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data.url || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── BACKGROUND SYNC — for journal entries offline ──
self.addEventListener('sync', event => {
  if (event.tag === 'sync-journal') {
    event.waitUntil(syncJournalEntries());
  }
});

async function syncJournalEntries() {
  console.log('[IWAG SW] Background sync: journal entries');
  // When backend is connected, sync offline journal entries here
}
