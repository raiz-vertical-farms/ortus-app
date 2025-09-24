import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { InferRequestType, InferResponseType } from "hono/client";

/**
 * A generic mutation hook for hono client endpoints
 */
export function useMutation<TEndpoint extends (req: any) => Promise<Response>>(
  endpoint: TEndpoint
) {
  type Req = InferRequestType<TEndpoint>;
  type Res = InferResponseType<TEndpoint>;

  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const mutate = useCallback(
    async (req: Req): Promise<Res> => {
      setLoading(true);
      setError(null);
      try {
        const res = await endpoint(req);

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
        return json;
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [endpoint]
  );

  return { mutate, data, error, loading };
}

export function useQuery<TEndpoint extends (req: any) => Promise<Response>>(
  endpoint: TEndpoint,
  req: InferRequestType<TEndpoint> | null,
  options?: { enabled?: boolean }
) {
  type Req = InferRequestType<TEndpoint>;
  type Res = InferResponseType<TEndpoint>;

  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Keep the latest endpoint without making it a dependency
  const endpointRef = useRef(endpoint);
  useEffect(() => {
    endpointRef.current = endpoint;
  }, [endpoint]);

  const fetchData = useCallback(async (r: Req): Promise<Res> => {
    setLoading(true);
    setError(null);
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
      return json;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []); // stable

  // Memoize a stable key for effect deps
  const key = useMemo(
    () => JSON.stringify([req, options?.enabled !== false]),
    [req, options?.enabled]
  );

  useEffect(() => {
    if (!req || options?.enabled === false) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await fetchData(req as Req);
        if (cancelled) return;
        // data is already set inside fetchData; nothing else here
      } catch {
        if (cancelled) return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, fetchData]);

  const refetch = useCallback(() => {
    if (req) {
      return fetchData(req as Req);
    }
  }, [fetchData, req]);

  return { data, error, loading, refetch };
}
