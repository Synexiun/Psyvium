'use client';

/**
 * IndexedDB-backed offline outbox for session-note drafts.
 *
 * Closes a P0 clinical-safety gap (docs/technical/11-frontend-architecture.md
 * §5 / §4): session-note drafts previously lived only in `localStorage`,
 * scoped to the current tab and vulnerable to eviction — "clinicians never
 * lose a note" was a promise the app didn't keep. IndexedDB is durable
 * per-origin storage that survives a closed tab, so the note text and any
 * unsent "file note" submission both outlive the tab that created them.
 *
 * A record has two shapes of intent, distinguished by `status`:
 *  - 'draft'        — the clinician is still typing; durably persisted so the
 *                      text can be recovered after a tab close, but NEVER
 *                      auto-submitted. Filing a note stays an explicit
 *                      clinician action (see session/page.tsx `fileNote`).
 *  - 'pending-file'  — the clinician already clicked "File note" and the
 *                      request could not reach the server (offline / network
 *                      failure). This is queued to actually complete the
 *                      filing once connectivity returns.
 *
 * flush() only ever POSTs 'pending-file' records — a plain in-progress draft
 * is never turned into a filed clinical note behind the clinician's back. A
 * record is removed only once the server confirms the write; any failure
 * (still offline, 5xx, etc.) leaves it queued for the next flush attempt, so
 * a queued file-note action is never silently dropped.
 */
import { api } from './api';

const DB_NAME = 'vpsy-outbox';
const DB_VERSION = 1;
const STORE = 'session-note-drafts';
const SYNC_TAG = 'vpsy-outbox-sync';

/** Dispatched on `window` whenever flush() runs and produces a result — pages listen to react to their own session's draft syncing. */
export const OUTBOX_FLUSHED_EVENT = 'vpsy:outbox-flushed';

export interface OutboxDraft {
  /** Stable id for this draft. Callers key it by sessionId — one in-flight draft per session, so re-enqueuing updates it in place rather than duplicating. */
  id: string;
  sessionId: string;
  narrative: string;
  status: 'draft' | 'pending-file';
  /** ISO timestamp of the last local edit — used to prefer the newer copy when reconciling against localStorage on reopen. */
  updatedAt: string;
}

export interface FlushResult {
  syncedIds: string[];
  failedIds: string[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function supportsIndexedDb(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Durably stores (or updates) a draft. Safe to call on every keystroke — it's a local put, not a network call. */
export async function enqueue(draft: OutboxDraft): Promise<void> {
  if (!supportsIndexedDb()) return; // no durable path available on this browser — the caller's localStorage autosave still covers same-tab recovery
  await withStore('readwrite', (store) => store.put(draft));
  if (draft.status === 'pending-file') await requestBackgroundSync();
}

export async function list(): Promise<OutboxDraft[]> {
  if (!supportsIndexedDb()) return [];
  return withStore('readonly', (store) => store.getAll());
}

export async function remove(id: string): Promise<void> {
  if (!supportsIndexedDb()) return;
  await withStore('readwrite', (store) => store.delete(id));
}

/**
 * POSTs every 'pending-file' draft via the existing API client. A draft is
 * removed only after the server confirms the write; anything that fails
 * (still offline, 4xx/5xx) stays queued for the next attempt — never dropped.
 */
export async function flush(): Promise<FlushResult> {
  const result: FlushResult = { syncedIds: [], failedIds: [] };
  if (!supportsIndexedDb()) return result;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return result;

  const drafts = await list();
  for (const draft of drafts) {
    if (draft.status !== 'pending-file') continue;
    try {
      await api.createSessionNote(draft.sessionId, { format: 'narrative', narrative: draft.narrative });
      await remove(draft.id);
      result.syncedIds.push(draft.id);
    } catch {
      result.failedIds.push(draft.id);
    }
  }

  if (typeof window !== 'undefined' && (result.syncedIds.length > 0 || result.failedIds.length > 0)) {
    window.dispatchEvent(new CustomEvent<FlushResult>(OUTBOX_FLUSHED_EVENT, { detail: result }));
  }
  return result;
}

async function requestBackgroundSync(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    // Background Sync isn't in TS's DOM lib yet — feature-detect via a loose cast rather than pulling in a types package.
    const syncManager = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync;
    await syncManager?.register(SYNC_TAG);
  } catch {
    // Unsupported (e.g. Safari) or registration failed — the window 'online' listener below is the fallback path.
  }
}

let autoFlushWired = false;

/**
 * Wires the durability net once per page load:
 *  - a `window` 'online' listener, so reconnecting while the tab is open flushes immediately;
 *  - a service-worker message listener, so a Background Sync wake-up (the tab may not have regained focus) still flushes;
 *  - one immediate attempt, in case connectivity returned while the page was closed.
 * Idempotent — safe to call from every page that mounts the root layout's registration component.
 */
export function registerAutoFlush(): void {
  if (autoFlushWired || typeof window === 'undefined') return;
  autoFlushWired = true;

  const run = () => void flush();

  window.addEventListener('online', run);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if ((event as MessageEvent).data?.type === 'FLUSH_OUTBOX') run();
    });
  }
  if (typeof navigator === 'undefined' || navigator.onLine) run();
}
