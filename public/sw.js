/* eslint-env serviceworker */

const SHELL_CACHE = 'efulfill-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await cache.add(OFFLINE_URL);
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isOperationalRequest(request) {
  const url = new URL(request.url);
  return request.method !== 'GET'
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/_next/')
    || url.pathname.includes('/events/stream')
    || url.pathname.includes('/manifest')
    || url.pathname.endsWith('/sw.js')
    || url.pathname.includes('/print-label')
    || url.pathname.includes('/shipping-label');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (isOperationalRequest(request) || request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(async () => {
      const offline = await caches.match(OFFLINE_URL);
      return offline ?? Response.error();
    }),
  );
});
