// hooks/useMutation.ts
import { useState } from "react";

// Infer the body type from the fetch function
type ExtractJsonArg<T> = T extends (init: { json: infer U }) => any ? U : never;
type ExtractJsonResponse<T> = T extends (...args: any[]) => Promise<infer R>
  ? R extends { json: () => Promise<infer U> }
    ? U
    : never
  : never;

export function useMutation<Fn extends (init: any) => Promise<any>>(
  fetchFn: Fn
) {
  const [data, setData] = useState<ExtractJsonResponse<Fn> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const mutate = async (
    body: ExtractJsonArg<Fn>
  ): Promise<ExtractJsonResponse<Fn>> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFn({
        json: body,
        Headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer " + localStorage.getItem("token") || "",
        },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message);
      }

      setData(json);
      return json;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { mutate, data, loading, error };
}
