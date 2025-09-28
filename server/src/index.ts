import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { generateSpecs, openAPIRouteHandler } from "hono-openapi";
import "dotenv/config";
import routes from "./routes";
import fs from "fs";

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

app.get(
  "/openapi.json",
  openAPIRouteHandler(routes, {
    documentation: {
      info: {
        title: "Raiz API",
        version: "1.0.0",
        description: "API for the Raiz platform",
      },
    },
  })
);

app.route("/", routes);

if (process.env.NODE_ENV !== "production") {
  serve({ fetch: app.fetch, port: 3000 });
  generateSpecs(app, {
    documentation: {
      info: {
        title: "Raiz API",
        version: "1.0.0",
        description: "API for the Raiz platform",
      },
    },
  }).then((specs) => {
    fs.writeFileSync("../client/openapi.json", JSON.stringify(specs, null, 2));
    console.log("Generated OpenAPI specs:");
  });
}

export default app;

export const config = {
  runtime: "nodejs20",
};
