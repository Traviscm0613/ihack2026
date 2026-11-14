/* Offline production app shell. API data stays in the account's SQLite cache. */
const CACHE = 'locallearn-shell-v1';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const manifest = await (await fetch('/offline-manifest.json', {cache: 'no-store'})).json();
    const cache = await caches.open(CACHE);
    await cache.addAll(manifest);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {event.waitUntil(self.clients.claim());});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Fetch navigations first so a deployed update can install its new worker.
    if (event.request.mode === 'navigate') {
      try {return await fetch(event.request);} catch {return (await cache.match('/index.html')) || Response.error();}
    }
    return (await cache.match(event.request)) || fetch(event.request);
  })());
});
