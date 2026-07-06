// VPSY OS service worker — minimal, hand-written, no build-tool dependency
// (no next-pwa / workbox). Registered client-side by
// src/components/ServiceWorkerRegistration.tsx.
//
// Scope: app-shell + static-asset caching so the shell loads offline, plus a
// message bridge that lets the IndexedDB offline outbox
// (src/lib/offline-outbox.ts) flush automatically on Background Sync.
//
// Clinical-safety rule (docs/technical/11-frontend-architecture.md §5):
// "Clinical writes are never served from stale cache." Every request under
// /api/backend/* is left untouched — always straight to the network, never
// cached, never answered from a cache on failure. Only the static shell
// (HTML navigations + hashed /_next/static assets + the manifest/icon) is
// cached.
//
// Update flow: this worker deliberately does NOT call self.skipWaiting() /
// clients.claim() on install — a newly installed worker waits (the browser's
// default lifecycle) until every tab running the old worker has closed, so a
// clinician is never silently switched to a new app version mid-session.

const CACHE_VERSION = 'vpsy-shell-v1';
const SHELL_URLS = ['/', '/login', '/manifest.webmanifest', '/icon.svg'];
const SYNC_TAG = 'vpsy-outbox-sync';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined), // best-effort — a failed precache must never block install
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/backend/');
}

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg' || url.pathname === '/manifest.webmanifest';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // mutations are never intercepted — the offline outbox handles those explicitly

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // no cross-origin caching
  if (isApiRequest(url)) return; // clinical data: always network, never cache, never served stale

  if (isStaticAsset(url)) {
    // Content-hashed / versioned assets — cache-first for instant offline
    // load, refreshed in the background on every hit.
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          event.waitUntil(
            fetch(request)
              .then((res) => {
                if (res.ok) cache.put(request, res.clone());
              })
              .catch(() => undefined),
          );
          return cached;
        }
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          return Response.error();
        }
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    // App-shell navigations — network-first (a signed-in clinician always
    // gets the latest UI when online); falls back to the cached shell so the
    // app still launches offline.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          return (await cache.match(request)) ?? (await cache.match('/')) ?? Response.error();
        }
      })(),
    );
  }
});

// Background Sync — fired by the browser once connectivity returns, for the
// 'vpsy-outbox-sync' tag registered by offline-outbox.ts whenever it queues a
// pending-file draft. The access token lives in localStorage, which a service
// worker cannot read, so the actual POST is delegated to an open page:
// registerAutoFlush() in offline-outbox.ts listens for this message and calls
// flush() with the real Authorization header. The window 'online' listener
// there is the fallback for browsers without Background Sync (e.g. Safari).
self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'FLUSH_OUTBOX' });
    }),
  );
});
