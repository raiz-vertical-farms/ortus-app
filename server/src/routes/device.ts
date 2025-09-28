import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import { z } from "zod";
import { mqttClient } from "../services/mqtt";
import { db } from "../db";

const createDeviceRequestSchema = z.object({
  unique_id: z.string(),
  name: z.string().min(1),
  organization_id: z.number(),
});

const deviceSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  organization_id: z.number(),
});

const createDeviceResponseSchema = z.object({
  device: deviceSummarySchema,
});

const errorResponseSchema = z.object({
  message: z.string(),
});

const switchCommandRequestSchema = z.object({
  state: z.enum(["ON", "OFF"]),
});

const commandSuccessResponseSchema = z.object({
  message: z.string(),
});

const lightCommandRequestSchema = z.object({
  state: z.enum(["ON", "OFF"]).optional(),
  brightness: z.number().min(0).max(100).optional(),
});

const lightCommandResponseSchema = commandSuccessResponseSchema.extend({
  payload: lightCommandRequestSchema,
});

const numberCommandRequestSchema = z.object({
  value: z.number(),
});

const numberCommandResponseSchema = commandSuccessResponseSchema.extend({
  value: z.number(),
});

const deviceStateSchema = z.object({
  id: z.number(),
  name: z.string(),
  unique_id: z.string(),
  organization_id: z.number(),
  online: z.number().nullable(),
  last_seen: z.string().nullable(),
  switch_state: z.string().nullable(),
  light_state: z.string().nullable(),
  light_brightness: z.number().nullable(),
  number_of_plants: z.number(),
});

const deviceStateResponseSchema = z.object({
  state: deviceStateSchema,
});

const deviceListItemSchema = deviceStateSchema.omit({ number_of_plants: true });

const deviceListResponseSchema = z.object({
  devices: z.array(deviceListItemSchema),
});

const app = new Hono()
  .post(
    "/create",
    describeRoute({
      operationId: "createDevice",
      summary: "Register a new device",
      tags: ["Devices"],
      responses: {
        200: {
          description: "Device created",
          content: {
            "application/json": {
              schema: resolver(createDeviceResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createDeviceRequestSchema),
    async (c) => {
      const { name, organization_id, unique_id } = c.req.valid("json");
      const now = new Date().toISOString();

      const device = await db
        .insertInto("devices")
        .values({ name, unique_id, organization_id, created_at: now })
        .returning(["id", "name", "organization_id"])
        .executeTakeFirstOrThrow();

      return c.json({ device });
    }
  )
  .post(
    "/:id/switch/:switchId",
    describeRoute({
      operationId: "deviceSwitch",
      summary: "Send a switch command to a device",
      tags: ["Devices"],
      responses: {
        200: {
          description: "Command enqueued",
          content: {
            "application/json": {
              schema: resolver(commandSuccessResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", switchCommandRequestSchema),
    async (c) => {
      const device_id = Number(c.req.param("id"));
      const switchId = c.req.param("switchId");
      const { state } = c.req.valid("json");

      if (isNaN(device_id)) {
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device ID" }, 400),
        });
      }

      const topic = `${device_id}/switch/${switchId}/command`;

      mqttClient.publish(topic, state, async (err) => {
        if (!err) {
          await db
            .updateTable("devices")
            .set({ switch_state: state })
            .where("id", "=", device_id)
            .execute();
        }
      });

      return c.json({
        message: `Switch ${switchId} set to ${state}`,
      });
    }
  )
  .post(
    "/:id/light/:lightId",
    describeRoute({
      operationId: "deviceLight",
      summary: "Send a light command to a device",
      tags: ["Devices"],
      responses: {
        200: {
          description: "Command enqueued",
          content: {
            "application/json": {
              schema: resolver(lightCommandResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", lightCommandRequestSchema),
    async (c) => {
      const device_id = Number(c.req.param("id"));
      const lightId = c.req.param("lightId");
      const { state, brightness } = c.req.valid("json");

      if (isNaN(device_id)) {
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device ID" }, 400),
        });
      }

      const topic = `${device_id}/light/${lightId}/command`;
      const payload: Record<string, any> = {};
      if (state) payload.state = state;
      if (brightness !== undefined) payload.brightness = brightness;

      mqttClient.publish(topic, JSON.stringify(payload), async (err) => {
        if (!err) {
          const updateValues: Partial<{
            light_state: string;
            light_brightness: number;
          }> = {};

          if (state) updateValues.light_state = state;
          if (brightness !== undefined)
            updateValues.light_brightness = brightness;

          if (Object.keys(updateValues).length > 0) {
            await db
              .updateTable("devices")
              .set(updateValues)
              .where("id", "=", device_id)
              .execute();
          }
        }
      });

      return c.json({
        message: `Light command sent`,
        payload,
      });
    }
  )
  .post(
    "/:id/number/:numberId",
    describeRoute({
      operationId: "deviceNumber",
      summary: "Send a numeric command to a device",
      tags: ["Devices"],
      responses: {
        200: {
          description: "Command enqueued",
          content: {
            "application/json": {
              schema: resolver(numberCommandResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", numberCommandRequestSchema),
    async (c) => {
      const device_id = Number(c.req.param("id"));
      const numberId = c.req.param("numberId");
      const { value } = c.req.valid("json");

      if (isNaN(device_id)) {
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device ID" }, 400),
        });
      }

      const topic = `${device_id}/number/${numberId}/command`;

      mqttClient.publish(topic, String(value));

      return c.json({
        message: `Number ${numberId} updated`,
        value,
      });
    }
  )
  .get(
    "/:id/state",
    describeRoute({
      operationId: "deviceState",
      summary: "Retrieve the latest state for a specific device",
      tags: ["Devices"],
      responses: {
        200: {
          description: "Device state",
          content: {
            "application/json": {
              schema: resolver(deviceStateResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const device_id = Number(c.req.param("id"));

      if (isNaN(device_id)) {
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device ID" }, 400),
        });
      }

      const device = await db
        .selectFrom("devices")
        .select([
          "id",
          "name",
          "unique_id",
          "organization_id",
          "online",
          "last_seen",
          "switch_state",
          "light_state",
          "light_brightness",
        ])
        .select((eb) =>
          eb
            .selectFrom("plants")
            .whereRef("plants.device_id", "=", "devices.id")
            .select((eb2) => eb2.fn.countAll().as("number_of_plants"))
            .as("number_of_plants")
        )
        .where("id", "=", device_id)
        .executeTakeFirst();

      if (!device) {
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });
      }

      return c.json({
        state: device,
      });
    }
  )
  .get(
    "/devices",
    describeRoute({
      operationId: "allDevices",
      summary: "List devices",
      tags: ["Devices"],
      responses: {
        200: {
          description: "Successful response",
          content: {
            "application/json": {
              schema: resolver(deviceListResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const devices = await db
        .selectFrom("devices")
        .select([
          "id",
          "name",
          "unique_id",
          "organization_id",
          "online",
          "last_seen",
          "switch_state",
          "light_state",
          "light_brightness",
        ])
        .execute();

      return c.json({
        devices,
      });
    }
  );

export default app;

export type AppType = typeof app;
