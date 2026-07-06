'use client';

/**
 * Real-time push client (SP3 — "live push, without lag"). One Socket.IO
 * connection is shared for the whole portal via `LiveEventsProvider`
 * (mounted once in the portal layout); pages call `useLiveEvents()` to read
 * the connection status and subscribe to a curated set of event types.
 *
 * - Auth: the handshake carries the SAME stored access token as HTTP calls
 *   (`auth: () => ({ token: getToken() })` re-reads it on every (re)connect
 *   attempt, so a token refreshed after login/expiry is picked up without a
 *   page reload).
 * - Reconnection: socket.io-client's built-in exponential backoff; UI status
 *   flips through connecting → live → reconnecting → offline so the command
 *   strip can show an honest indicator (never a fake "live" while retrying).
 * - PHI: every event on the wire is a `LiveEvent` — ids/refs/status/timestamps
 *   only (see `@vpsy/contracts`). This client never expects clinical
 *   free-text here; pages reload their own resource over the normal REST API.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { REALTIME_SOCKET_EVENT, type LiveEvent, type RealtimeEventType } from '@vpsy/contracts';
import { getToken } from './api';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

type Listener = { match: (e: LiveEvent) => boolean; handler: (e: LiveEvent) => void };

export interface LiveEventsValue {
  status: LiveStatus;
  lastEvent: LiveEvent | null;
  /** Fires `handler` for every future event whose `type` is in `types`. Returns an unsubscribe fn. */
  subscribe: (types: RealtimeEventType[], handler: (e: LiveEvent) => void) => () => void;
}

const LiveEventsContext = createContext<LiveEventsValue | null>(null);

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

export function LiveEventsProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const listenersRef = useRef(new Set<Listener>());

  useEffect(() => {
    // No stored session yet (e.g. on /login) — nothing to connect to.
    if (!getToken()) {
      setStatus('offline');
      return;
    }

    const socket: Socket = io(apiOrigin(), {
      path: '/socket.io',
      // Re-read the token on every (re)connection attempt rather than once
      // at construction, so a freshly-issued token is always used.
      auth: (cb) => cb({ token: getToken() ?? '' }),
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setStatus('live'));
    socket.on('disconnect', (reason) => {
      // A server-initiated disconnect (e.g. rejected/expired auth) won't
      // auto-reconnect on its own — nudge it so an expired token gets
      // re-verified against a fresh one on the next attempt.
      setStatus('reconnecting');
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    socket.on('connect_error', () => setStatus('reconnecting'));

    socket.on(REALTIME_SOCKET_EVENT, (evt: LiveEvent) => {
      setLastEvent(evt);
      for (const l of listenersRef.current) {
        if (l.match(evt)) l.handler(evt);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const value = useMemo<LiveEventsValue>(
    () => ({
      status,
      lastEvent,
      subscribe: (types, handler) => {
        const set = new Set(types);
        const entry: Listener = { match: (e) => set.has(e.type), handler };
        listenersRef.current.add(entry);
        return () => listenersRef.current.delete(entry);
      },
    }),
    [status, lastEvent],
  );

  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

export function useLiveEvents(): LiveEventsValue {
  const ctx = useContext(LiveEventsContext);
  if (!ctx) throw new Error('useLiveEvents must be used inside <LiveEventsProvider>');
  return ctx;
}

/**
 * Convenience: re-run `onEvent` (typically a resource's `reload`) whenever a
 * live event of one of `types` arrives. Always calls the LATEST `onEvent`
 * closure without re-subscribing every render (same pattern as `useResource`).
 */
export function useLiveRefresh(types: RealtimeEventType[], onEvent: () => void): void {
  const { subscribe } = useLiveEvents();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const key = types.join(',');

  useEffect(() => {
    return subscribe(types, () => onEventRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, key]);
}
