import { Hono } from "hono";
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
  success: z.literal(true),
  device: deviceSummarySchema,
});

const deviceErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const switchCommandRequestSchema = z.object({
  state: z.enum(["ON", "OFF"]),
});

const commandSuccessResponseSchema = z.object({
  success: z.literal(true),
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
  success: z.literal(true),
  state: deviceStateSchema,
});

const deviceListItemSchema = deviceStateSchema.omit({ number_of_plants: true });

const deviceListResponseSchema = z.object({
  success: z.literal(true),
  devices: z.array(deviceListItemSchema),
});

const app = new Hono()
  .post(
    "/create",
    describeRoute({
      summary: "Register a new device",
      tags: ["Devices"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: resolver(createDeviceRequestSchema),
          },
        },
      },
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

      return c.json({ success: true, device });
    }
  )
  .post(
    "/:id/switch/:switchId",
    describeRoute({
      summary: "Send a switch command to a device",
      tags: ["Devices"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string" },
          description: "Device identifier",
        },
        {
          in: "path",
          name: "switchId",
          required: true,
          schema: { type: "string" },
          description: "Switch channel identifier",
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: resolver(switchCommandRequestSchema),
          },
        },
      },
      responses: {
        200: {
          description: "Command enqueued",
          content: {
            "application/json": {
              schema: resolver(commandSuccessResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid device identifier",
          content: {
            "application/json": {
              schema: resolver(deviceErrorResponseSchema),
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
        return c.json({ success: false, error: "Invalid device ID" }, 400);
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
        success: true,
        message: `Switch ${switchId} set to ${state}`,
      });
    }
  )
  .post(
    "/:id/light/:lightId",
    describeRoute({
      summary: "Send a light command to a device",
      tags: ["Devices"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string" },
          description: "Device identifier",
        },
        {
          in: "path",
          name: "lightId",
          required: true,
          schema: { type: "string" },
          description: "Light channel identifier",
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: resolver(lightCommandRequestSchema),
          },
        },
      },
      responses: {
        200: {
          description: "Command enqueued",
          content: {
            "application/json": {
              schema: resolver(lightCommandResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid device identifier",
          content: {
            "application/json": {
              schema: resolver(deviceErrorResponseSchema),
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
        return c.json({ success: false, error: "Invalid device ID" }, 400);
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
        success: true,
        message: `Light command sent`,
        payload,
      });
    }
  )
  .post(
    "/:id/number/:numberId",
    describeRoute({
      summary: "Send a numeric command to a device",
      tags: ["Devices"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string" },
          description: "Device identifier",
        },
        {
          in: "path",
          name: "numberId",
          required: true,
          schema: { type: "string" },
          description: "Numeric channel identifier",
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: resolver(numberCommandRequestSchema),
          },
        },
      },
      responses: {
        200: {
          description: "Command enqueued",
          content: {
            "application/json": {
              schema: resolver(numberCommandResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid device identifier",
          content: {
            "application/json": {
              schema: resolver(deviceErrorResponseSchema),
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
        return c.json({ success: false, error: "Invalid device ID" }, 400);
      }

      const topic = `${device_id}/number/${numberId}/command`;

      mqttClient.publish(topic, String(value));

      return c.json({
        success: true,
        message: `Number ${numberId} updated`,
        value,
      });
    }
  )
  .get(
    "/:id/state",
    describeRoute({
      summary: "Retrieve the latest state for a specific device",
      tags: ["Devices"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string" },
          description: "Device identifier",
        },
      ],
      responses: {
        200: {
          description: "Device state",
          content: {
            "application/json": {
              schema: resolver(deviceStateResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid device identifier",
          content: {
            "application/json": {
              schema: resolver(deviceErrorResponseSchema),
            },
          },
        },
        404: {
          description: "Device not found",
          content: {
            "application/json": {
              schema: resolver(deviceErrorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const device_id = Number(c.req.param("id"));

      if (isNaN(device_id)) {
        return c.json({ success: false, error: "Invalid device ID" }, 400);
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
        return c.json({ success: false, error: "Device not found" }, 404);
      }

      return c.json({
        success: true,
        state: device,
      });
    }
  )
  .get(
    "/devices",
    describeRoute({
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
        success: true,
        devices,
      });
    }
  );

export default app;

export type AppType = typeof app;
