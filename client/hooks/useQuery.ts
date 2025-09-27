import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// Simple cache implementation
class QueryCache {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes default

  set(key: string, data: any, ttl?: number) {
    this.cache.set(key, {
      data,
      timestamp: Date.now() + (ttl ?? this.defaultTTL),
    });
  }

  get(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.timestamp) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  invalidate(key: string) {
    this.cache.delete(key);
  }

  invalidateAll() {
    this.cache.clear();
  }

  // Clean up expired entries periodically
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache instance (you might want to provide this via context instead)
const queryCache = new QueryCache();

// Cleanup expired entries every minute
setInterval(() => queryCache.cleanup(), 60000);

type InferRequestType<T> = T extends (req: infer R) => any ? R : never;
type InferResponseType<T> = T extends (req: any) => Promise<infer R>
  ? R extends Response
    ? Awaited<ReturnType<R["json"]>>
    : never
  : never;

export interface QueryOptions {
  enabled?: boolean;
  pollInterval?: number;
  cacheTime?: number; // TTL in milliseconds
  staleTime?: number; // Time before data is considered stale
  cacheKey?: string; // Optional custom cache key
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
}

export function useQuery<TEndpoint extends (req: any) => Promise<Response>>(
  endpoint: TEndpoint,
  req: InferRequestType<TEndpoint> | null,
  options?: QueryOptions
) {
  type Req = InferRequestType<TEndpoint>;
  type Res = InferResponseType<TEndpoint>;

  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);

  // Keep the latest endpoint without making it a dependency
  const endpointRef = useRef(endpoint);
  useEffect(() => {
    endpointRef.current = endpoint;
  }, [endpoint]);

  // Generate cache key
  const cacheKey = useMemo(() => {
    if (options?.cacheKey) return options.cacheKey;
    if (!req) return null;
    // Include endpoint name if available for better cache isolation
    const endpointName = endpoint.name || "query";
    return `${endpointName}:${JSON.stringify(req)}`;
  }, [req, options?.cacheKey, endpoint.name]);

  // Track stale timer
  const staleTimerRef = useRef<NodeJS.Timeout>(null);

  const fetchData = useCallback(
    async (r: Req, ignoreCache = false): Promise<Res> => {
      // Check cache first (unless explicitly ignoring)
      if (!ignoreCache && cacheKey) {
        const cached = queryCache.get(cacheKey);
        if (cached !== null) {
          setData(cached);
          setError(null);
          setIsStale(false);

          // Set up stale timer
          if (options?.staleTime && options.staleTime > 0) {
            staleTimerRef.current && clearTimeout(staleTimerRef.current);
            staleTimerRef.current = setTimeout(() => {
              setIsStale(true);
            }, options.staleTime);
          }

          return cached;
        }
      }

      setLoading(true);
      setError(null);
      setIsStale(false);

      try {
        const res = await endpointRef.current(r);
        if (!res.ok) {
          let errBody: any;
          try {
            errBody = await res.json();
          } catch {
            errBody = { error: res.statusText, status: res.status };
          }
          throw errBody;
        }

        const json = (await res.json()) as Res;
        setData(json);

        // Cache the result
        if (cacheKey) {
          queryCache.set(cacheKey, json, options?.cacheTime);
        }

        // Set up stale timer
        if (options?.staleTime && options.staleTime > 0) {
          staleTimerRef.current && clearTimeout(staleTimerRef.current);
          staleTimerRef.current = setTimeout(() => {
            setIsStale(true);
          }, options.staleTime);
        }

        return json;
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [cacheKey, options?.cacheTime, options?.staleTime]
  );

  // Stable key for initial fetch
  const key = useMemo(
    () => JSON.stringify([req, options?.enabled !== false]),
    [req, options?.enabled]
  );

  // Initial/one-off fetch when req/enabled change
  useEffect(() => {
    if (!req || options?.enabled === false) return;

    let cancelled = false;

    (async () => {
      try {
        // Try to load from cache first
        await fetchData(req as Req);
      } catch {}
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
  }, [key, fetchData]);

  // Simple polling (no overlaps)
  useEffect(() => {
    if (!req || options?.enabled === false) return;
    const interval = options?.pollInterval ?? 0;
    if (interval <= 0) return;

    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        // Polling always bypasses cache to get fresh data
        await fetchData(req as Req, true);
      } catch {}
      inFlight = false;
    };

    const id = setInterval(tick, interval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [req, options?.enabled, options?.pollInterval, fetchData]);

  // Refetch on window focus
  useEffect(() => {
    if (!options?.refetchOnWindowFocus || !req || options?.enabled === false)
      return;

    const handleFocus = () => {
      if (isStale) {
        fetchData(req as Req, true).catch(() => {});
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [
    options?.refetchOnWindowFocus,
    options?.enabled,
    req,
    isStale,
    fetchData,
  ]);

  // Refetch on reconnect
  useEffect(() => {
    if (!options?.refetchOnReconnect || !req || options?.enabled === false)
      return;

    const handleOnline = () => {
      fetchData(req as Req, true).catch(() => {});
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [options?.refetchOnReconnect, options?.enabled, req, fetchData]);

  const refetch = useCallback(() => {
    if (req) {
      // Refetch always bypasses cache
      return fetchData(req as Req, true);
    }
  }, [fetchData, req]);

  const invalidateCache = useCallback(() => {
    if (cacheKey) {
      queryCache.invalidate(cacheKey);
    }
  }, [cacheKey]);

  // Cleanup stale timer on unmount
  useEffect(() => {
    return () => {
      if (staleTimerRef.current) {
        clearTimeout(staleTimerRef.current);
      }
    };
  }, []);

  return {
    data,
    error,
    loading,
    isStale,
    refetch,
    invalidateCache,
    // Expose cache utilities
    cache: {
      invalidate: invalidateCache,
      invalidateAll: () => queryCache.invalidateAll(),
    },
  };
}

// Export cache for external control if needed
export const cache = {
  invalidate: (key: string) => queryCache.invalidate(key),
  invalidateAll: () => queryCache.invalidateAll(),
  get: (key: string) => queryCache.get(key),
  set: (key: string, data: any, ttl?: number) => queryCache.set(key, data, ttl),
};
