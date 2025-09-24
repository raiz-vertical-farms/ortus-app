import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import "dotenv/config";
import routes from "./routes";

console.log("🚀 Starting Hono server...");

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

app.route("/", routes);

if (process.env.NODE_ENV !== "production") {
  serve({ fetch: app.fetch, port: 3000 });
}

export default app;

export const config = {
  runtime: "nodejs20",
};
