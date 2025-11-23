import { Hono } from "hono";
import deviceRoutes from "./device";
import networkRoutes from "./network";

const routes = new Hono()
  .route("/api/device", deviceRoutes)
  .route("/api/network", networkRoutes);

export type AppType = typeof routes;
export default routes;
