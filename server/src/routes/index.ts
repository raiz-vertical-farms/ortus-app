import { Hono } from "hono";
import deviceRoutes from "./device";
import networkRoutes from "./network";
import webhookRoutes from "./webhooks";

const routes = new Hono()
  .route("/api/device", deviceRoutes)
  .route("/api/network", networkRoutes)
  .route("/webhooks", webhookRoutes);

export type AppType = typeof routes;
export default routes;
