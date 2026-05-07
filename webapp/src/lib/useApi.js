import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tiny async-state hook for read endpoints.
 *
 *   const { data, loading, error, retry } = useApi(() => api.history(docId), [docId]);
 *
 * - `fetcher` should be a stable function or wrapped via useCallback by the
 *   caller; `deps` controls re-fetching the same way useEffect deps do.
 * - On unmount we drop late results so we don't setState on a dead component.
 * - Errors are exposed as-is (typically ApiError) so the UI can render
 *   `error.code` / `error.status` without a separate try/catch in each page.
 */
export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);
  const tickRef = useRef(0);

  const run = useCallback(async () => {
    const tick = ++tickRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (!aliveRef.current || tick !== tickRef.current) return;
      setData(result);
    } catch (err) {
      if (!aliveRef.current || tick !== tickRef.current) return;
      setError(err);
    } finally {
      if (aliveRef.current && tick === tickRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    aliveRef.current = true;
    run();
    return () => {
      aliveRef.current = false;
    };
  }, [run]);

  return { data, loading, error, retry: run };
}
