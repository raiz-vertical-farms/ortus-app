import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { generateSpecs, openAPIRouteHandler } from "hono-openapi";
import "dotenv/config";
import routes from "./routes";
import fs from "fs";
import { mqttClient } from "./services/mqtt";
import { Scalar } from "@scalar/hono-api-reference";
import { clerkMiddleware } from "@hono/clerk-auth";

console.log("🚀 Starting Hono server...");

// TODO: We shouldnt have to do this, and just run initMQTT or something
mqttClient.on("error", (err) => {
  console.error("MQTT connection error:", err);
});

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
    credentials: true,
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

// This is not auth middleware, but just injects the Clerk user into the request
app.use("*", clerkMiddleware());

app.route("/", routes);

app.get(
  "/scalar",
  Scalar({
    url: "/openapi.json",
  })
);

if (process.env.NODE_ENV !== "production") {
  serve({ fetch: app.fetch, port: 3000 });
  console.log("🟢 Server is running at http://localhost:3000");
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
    console.log("✅ Generated OpenAPI specs");
  });
}

export default app;

export const config = {
  runtime: "nodejs20",
};
