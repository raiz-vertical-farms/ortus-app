import {
  requestFn as defaultRequestFn,
  OperationSchema,
  RequestFnInfo,
  RequestFnResponse,
} from "@openapi-qraft/react";
import { createAPIClient } from "../api";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();

async function customRequestFn(
  schema: OperationSchema,
  requestInfo: RequestFnInfo
): Promise<RequestFnResponse<any, any>> {
  // Call Qraft’s default fetcher
  const response = await defaultRequestFn(schema, requestInfo);

  // Inspect response
  if (response && typeof response === "object" && "success" in response) {
    if (!(response as any).success) {
      throw new Error(
        (response as any).error ?? "API returned success = false"
      );
    }
  }

  return response;
}

export const client = createAPIClient({
  requestFn: customRequestFn,
  queryClient,
  baseUrl: import.meta.env.VITE_BACKEND_URL,
});
