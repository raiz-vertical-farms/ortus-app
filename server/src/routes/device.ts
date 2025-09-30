import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import { z } from "zod";
import { db } from "../db";
import { mqttClient } from "../services/mqtt";

const lightToggleSchema = z.object({
  state: z.enum(["on", "off"]),
});

const lightScheduleSchema = z.object({
  from_hour: z.number().min(0).max(23),
  from_minute: z.number().min(0).max(59),
  to_hour: z.number().min(0).max(23),
  to_minute: z.number().min(0).max(59),
});

const createDeviceRequestSchema = z.object({
  mac_address: z.string(),
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

const deviceStateSchema = z.object({
  id: z.number(),
  name: z.string(),
  mac_address: z.string(),
  organization_id: z.number(),
  last_seen: z.string().nullable(),
  left_light: z.string().nullable(),
  left_light_schedule: z.array(lightScheduleSchema).nullable(),
  right_light: z.string().nullable(),
  right_light_schedule: z.array(lightScheduleSchema).nullable(),
  water_level: z.string().nullable(),
  number_of_plants: z.number(),
});

const deviceStateResponseSchema = z.object({
  state: deviceStateSchema,
});

const deviceListItemSchema = deviceStateSchema.omit({
  number_of_plants: true,
  left_light: true,
  right_light: true,
  water_level: true,
});

const deviceListResponseSchema = z.object({
  devices: z.array(deviceListItemSchema),
});

async function getDeviceMac(id: number) {
  const device = await db
    .selectFrom("devices")
    .select(["mac_address"])
    .where("id", "=", id)
    .executeTakeFirst();
  return device?.mac_address || null;
}

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
      const { name, organization_id, mac_address } = c.req.valid("json");
      const now = new Date().toISOString();

      const device = await db
        .insertInto("devices")
        .values({ name, mac_address, organization_id, created_at: now })
        .returning(["id", "name", "organization_id"])
        .executeTakeFirstOrThrow();

      return c.json({ device });
    }
  )
  .get(
    ":id/state",
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
      const id = Number(c.req.param("id"));

      if (isNaN(id)) {
        throw new HTTPException(400, {
          res: c.json({ message: "Device ID is required" }, 400),
        });
      }

      const device = await db
        .selectFrom("devices")
        .select(["id", "name", "mac_address", "organization_id", "last_seen"])
        .select((eb) =>
          eb
            .selectFrom("plants")
            .whereRef("plants.device_id", "=", "devices.id")
            .select((eb2) => eb2.fn.countAll().as("number_of_plants"))
            .as("number_of_plants")
        )
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      const results = await db
        .selectFrom("device_timeseries as dt1")
        .select(["metric", "value_text"])
        .where("mac_address", "=", device.mac_address)
        .where("metric", "in", [
          "light_left",
          "light_right",
          "light_left/schedule",
          "light_right/schedule",
          "water_level",
        ])
        .where((eb) =>
          eb(
            "recorded_at",
            "=",
            eb
              .selectFrom("device_timeseries as dt2")
              .select(eb.fn.max("recorded_at").as("max_time"))
              .where("dt2.mac_address", "=", eb.ref("dt1.mac_address"))
              .where("dt2.metric", "=", eb.ref("dt1.metric"))
          )
        )
        .execute();

      const leftLight = results.find((r) => r.metric === "light_left");
      const leftLightSchedule = results.find(
        (r) => r.metric === "light_left/schedule"
      );
      const rightLight = results.find((r) => r.metric === "light_right");
      const rightLightSchedule = results.find(
        (r) => r.metric === "light_right/schedule"
      );
      const waterLevel = results.find((r) => r.metric === "water_level");

      if (!device) {
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });
      }

      return c.json({
        state: {
          ...device,
          left_light: leftLight ? leftLight.value_text : null,
          right_light: rightLight ? rightLight.value_text : null,
          left_light_schedule: leftLightSchedule
            ? JSON.parse(leftLightSchedule.value_text)
            : null,
          right_light_schedule: rightLightSchedule
            ? JSON.parse(rightLightSchedule.value_text)
            : null,
          water_level: waterLevel ? waterLevel.value_text : null,
        },
      });
    }
  )
  .get(
    "all",
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
        .select(["id", "name", "mac_address", "organization_id", "last_seen"])
        .execute();

      return c.json({
        devices,
      });
    }
  )
  .post(
    ":id/left-light/toggle",
    describeRoute({
      operationId: "toggleLeftLight",
      summary: "Turn left light on/off",
      tags: ["Devices"],
    }),
    zValidator("json", lightToggleSchema),
    async (c) => {
      const id = Number(c.req.param("id"));
      if (isNaN(id))
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device id" }, 400),
        });

      const mac = await getDeviceMac(id);
      if (!mac)
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });

      const { state } = c.req.valid("json");

      mqttClient.publish(`${mac}/light_left/command`, state);

      return c.json({ message: `Left light set to ${state}` });
    }
  )
  .post(
    ":id/right-light/toggle",
    describeRoute({
      operationId: "toggleRightLight",
      summary: "Turn right light on/off",
      tags: ["Devices"],
    }),
    zValidator("json", lightToggleSchema),
    async (c) => {
      const id = Number(c.req.param("id"));
      if (isNaN(id))
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device id" }, 400),
        });

      const mac = await getDeviceMac(id);
      if (!mac)
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });

      const { state } = c.req.valid("json");

      mqttClient.publish(`${mac}/light/light_right/command`, state);

      return c.json({ message: `Right light set to ${state}` });
    }
  )
  .post(
    ":id/left-light/schedule",
    describeRoute({
      operationId: "scheduleLeftLight",
      summary: "Set a schedule for left light",
      tags: ["Devices"],
    }),
    zValidator("json", lightScheduleSchema),
    async (c) => {
      const id = Number(c.req.param("id"));
      if (isNaN(id))
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device id" }, 400),
        });

      const mac = await getDeviceMac(id);
      if (!mac)
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });

      const schedule = c.req.valid("json");

      // Publish JSON payload for schedule
      mqttClient.publish(
        `${mac}/light/light_left/schedule/command`,
        JSON.stringify(schedule)
      );

      return c.json({ message: "Left light schedule updated", schedule });
    }
  )
  .post(
    ":id/right-light/schedule",
    describeRoute({
      operationId: "scheduleRightLight",
      summary: "Set a schedule for right light",
      tags: ["Devices"],
    }),
    zValidator("json", lightScheduleSchema),
    async (c) => {
      const id = Number(c.req.param("id"));
      if (isNaN(id))
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device id" }, 400),
        });

      const device = await db
        .selectFrom("devices")
        .select(["mac_address"])
        .where("id", "=", id)
        .executeTakeFirst();

      if (!device)
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });

      const schedule = c.req.valid("json");

      mqttClient.publish(
        `${device.mac_address}/light/light_right/schedule/command`,
        JSON.stringify(schedule)
      );

      return c.json({ message: "Right light schedule updated", schedule });
    }
  );

export default app;

export type AppType = typeof app;
