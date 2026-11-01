// Keeps the checker working offline.
const CACHE = 'work-diary-checker-v14';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'rules.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, so a new version shows as soon as the app is opened online. The cache is the
// fallback when there is no signal.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(event.request, { cache: 'no-cache' });
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      } catch (err) {
        const cached = await cache.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    })
  );
});
