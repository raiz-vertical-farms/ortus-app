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

async function getClerkToken() {
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
