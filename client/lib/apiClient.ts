import {
  requestFn as defaultRequestFn,
  OperationSchema,
  RequestFnInfo,
  RequestFnResponse,
} from "@openapi-qraft/react";
import { createAPIClient } from "../api";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();

type ClerkSession = {
  getToken: (options?: { template?: string }) => Promise<string | null>;
};

type ClerkInstance = {
  load?: () => Promise<void>;
  loaded?: boolean;
  session?: ClerkSession | null;
};

declare global {
  interface Window {
    Clerk?: ClerkInstance;
  }
}

export async function getClerkToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const clerk = window.Clerk;

  if (!clerk) {
    return null;
  }

  if (typeof clerk.load === "function" && clerk.loaded !== true) {
    await clerk.load();
  }

  const session = clerk.session;

  if (!session || typeof session.getToken !== "function") {
    return null;
  }

  try {
    return await session.getToken();
  } catch {
    return null;
  }
}

async function customRequestFn(
  schema: OperationSchema,
  requestInfo: RequestFnInfo
): Promise<RequestFnResponse<any, any>> {
  try {
    const clerkToken = await getClerkToken();
    const response = await defaultRequestFn(schema, {
      ...requestInfo,
      headers: {
        Authorization: `Bearer ${clerkToken}`,
        ...requestInfo.headers,
      },
      credentials: "include",
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

const BASE_URL = import.meta.env.VITE_BACKEND_URL ?? "";

export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = await getClerkToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res;
}
