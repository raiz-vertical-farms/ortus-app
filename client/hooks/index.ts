import { useState, useCallback } from "react";
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
