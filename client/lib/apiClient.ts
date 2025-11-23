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
  try {
    // get jwt from localStorage
    const token = localStorage.getItem("token");

    // inject into headers if available
    const headers = {
      ...(requestInfo.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const response = await defaultRequestFn(schema, {
      ...requestInfo,
      headers,
      credentials: "include",
      mode: "cors",
    });

    if (response && typeof response === "object" && "success" in response) {
      if (!(response as any).success) {
        throw new Error(
          (response as any).error ?? "API returned success = false"
        );
      }
    }

    return response;
  } catch (error) {
    throw error;
  }
}

export const client = createAPIClient({
  requestFn: customRequestFn,
  queryClient,
  baseUrl: import.meta.env.VITE_BACKEND_URL,
});
