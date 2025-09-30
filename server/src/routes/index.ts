import { Hono } from "hono";
import deviceRoutes from "./device";
import auth from "./auth";
import plantRoutes from "./plant";
import networkRoutes from "./network";

const routes = new Hono()
  .route("/api/auth", auth)
  .route("/api/plant", plantRoutes)
  .route("/api/device", deviceRoutes)
  .route("/api/network", networkRoutes);

export type AppType = typeof routes;
export default routes;
