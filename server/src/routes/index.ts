import { Hono } from "hono";
import deviceRoutes from "./device";
import auth from "./auth";
import plantRoutes from "./plant";

const routes = new Hono()
  .route("/api/auth", auth)
  .route("/api/plant", plantRoutes)
  .route("/api/device", deviceRoutes);

export type AppType = typeof routes;
export default routes;
