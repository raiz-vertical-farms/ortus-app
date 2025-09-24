import { hc } from "hono/client";
import type { AppType } from "../../server/src/routes";

const url = import.meta.env.VITE_BACKEND_URL;

export const client = hc<AppType>(url || "http://localhost:3000");

export const apiClient = client.api;
