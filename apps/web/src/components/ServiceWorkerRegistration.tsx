'use client';

/**
 * Registers the app-shell service worker (public/sw.js) and wires the
 * IndexedDB offline outbox's durability net (window 'online' listener +
 * Background Sync message bridge — see src/lib/offline-outbox.ts). Renders
 * nothing; mounted once from the root layout so it's active on every portal
 * screen, not just the session workspace.
 *
 * Guarded for:
 *  - browsers without service-worker support (the outbox auto-flush still
 *    works via the 'online' listener alone — Background Sync is additive);
 *  - non-production builds, where Next's dev server already rewrites/proxies
 *    aggressively and a long-lived SW cache would fight hot reload.
 */
import { useEffect } from 'react';
import { registerAutoFlush } from '@/lib/offline-outbox';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // The outbox durability net (online listener + SW message bridge) is
    // useful even without a registered service worker, so wire it first.
    registerAutoFlush();

    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failures (unsupported browser, blocked storage, private
      // browsing restrictions) must never break the app — it simply runs
      // without offline app-shell caching; the IndexedDB outbox above still
      // durably queues note drafts regardless.
    });
  }, []);

  return null;
}
