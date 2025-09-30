import { Hono } from "hono";
import deviceRoutes from "./device";
import auth from "./auth";
import plantRoutes from "./plant";
import { authMiddleware } from "../middleware/auth-middleware";

const routes = new Hono()
  .route("/api/auth", auth)
  .route("/api/plant", plantRoutes.use("*", authMiddleware))
  .route("/api/device", deviceRoutes.use("*", authMiddleware));

export type AppType = typeof routes;
export default routes;
