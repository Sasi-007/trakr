// This app works fully offline, so files are served from cache first and never
// wait on the network. Updates are fetched quietly in the background and applied
// on the next launch, which means CACHE_NAME does not need a manual bump to ship.
const CACHE_NAME = 'event-cal-v23';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/calendar.js',
  './js/storage.js',
  './js/datepicker.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache: 'reload' bypasses the HTTP cache so a precache always stores fresh files.
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate. This app is fully offline (all data lives in
  // localStorage), so the cached copy is served immediately and the page never
  // waits on the network. A refresh is fetched quietly in the background and is
  // picked up on the next launch; if there is no internet it simply fails silently.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkUpdate = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => null);

      if (cached) return cached;

      return networkUpdate.then((response) => {
        if (response) return response;
        // A navigation that misses the cache still gets the app shell.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
