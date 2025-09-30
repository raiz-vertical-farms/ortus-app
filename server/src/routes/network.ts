import { Hono } from "hono";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import { z } from "zod";
import { db } from "../db";
import { sql } from "kysely";
import { getConnInfo } from "@hono/node-server/conninfo";

const localDevicesSchema = z.object({
  mac_address: z.string(),
});

const app = new Hono()
  .get(
    "/my-ip",
    describeRoute({
      operationId: "myIp",
      summary: "Get my IP address",
      tags: ["Network"],
      responses: {
        200: {
          description: "Successful response",
          content: {
            "application/json": {
              schema: resolver(z.object({ ip: z.string() })),
            },
          },
        },
      },
    }),
    async (c) => {
      // TODO: If running locally we should call another 3rd party service
      const connInfo = getConnInfo(c);
      return c.json({ ip: connInfo.remote.address });
    }
  )
  .get(
    "local-devices",
    describeRoute({
      operationId: "localDevices",
      summary: "Get devices that recently announced presence from the same IP",
      tags: ["Devices"],
      responses: {
        200: {
          description: "Successful response",
          content: {
            "application/json": {
              schema: resolver(z.array(localDevicesSchema)),
            },
          },
        },
      },
    }),
    zValidator("query", z.object({ ip: z.string() })),
    async (c) => {
      const { ip } = c.req.valid("query");

      const recent = await db
        .selectFrom("device_timeseries")
        .select("mac_address")
        .distinct()
        .where("metric", "=", "presence")
        .where("value_text", "=", ip)
        .where("recorded_at", ">=", sql<string>`datetime('now', '-1 minute')`)
        .execute();

      return c.json(recent);
    }
  );

export default app;
