'use client';

/**
 * Thin data-fetching hook shared by every screen that talks to the live API.
 *
 * There is no fallback-to-fake path: a fetch either resolves with real data,
 * is still in flight, or failed. Callers render exactly those three states
 * (loading / error / data) — never a fabricated placeholder value.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseResourceResult<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
): UseResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  // Always call the latest fetcher without making it a effect dependency —
  // callers pass a fresh closure every render, only `deps`/reload matter.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload };
}
