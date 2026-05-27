/**
 * Native Nodes - Service Worker for Offline Execution
 * 
 * Implements a Stale-While-Revalidate caching strategy, enabling
 * instantaneous offline loads for local files and remote CDN dependencies.
 */

const CACHE_NAME = 'native-nodes-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/app.js',
  './js/editor.js',
  './js/graph.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  'https://esm.sh/marked@12.0.0',
  'https://esm.sh/dompurify@3.0.9'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Check cache first, serve instantly, but fetch in background to update
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, networkResponse);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Silence fetch errors (we are likely offline)
      });

      return cachedResponse || fetchPromise;
    })
  );
});
