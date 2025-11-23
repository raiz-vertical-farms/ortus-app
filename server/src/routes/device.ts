import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import { z } from "zod";
import { db } from "../db";
import { mqttClient } from "../services/mqtt";
import {
  removeLightSchedule,
  removePumpSchedule,
  setLightSchedule,
  setPumpSchedule,
} from "../cron";
import { authMiddleware } from "../middleware/auth-middleware";

const deleteDeviceResponseSchema = z.object({
  message: z.string(),
});

const lightToggleSchema = z.object({
  brightness: z.number().min(0).max(100),
});

const lightScheduleSchema = z.object({
  active: z.boolean(),
  on: z.number().int().nonnegative().describe("UTC timestamp in milliseconds"),
  off: z.number().int().nonnegative().describe("UTC timestamp in milliseconds"),
});

const pumpScheduleSchema = z.object({
  active: z.boolean(),
  start_time: z
    .number()
    .int()
    .nonnegative()
    .describe("UTC timestamp in milliseconds"),
  times_per_day: z
    .number()
    .int()
    .positive()
    .describe("Number of activations per UTC day"),
});

const scheduleLightRequestSchema = z.object({
  active: z.boolean(),
  on: z
    .number()
    .int()
    .nonnegative()
    .describe("UTC timestamp in milliseconds")
    .optional(),
  off: z
    .number()
    .int()
    .nonnegative()
    .describe("UTC timestamp in milliseconds")
    .optional(),
});

const schedulePumpRequestSchema = z.object({
  active: z.boolean(),
  start_time: z
    .number()
    .int()
    .nonnegative()
    .describe("UTC timestamp in milliseconds")
    .optional(),
  times_per_day: z
    .number()
    .int()
    .positive()
    .describe("Number of activations per UTC day")
    .optional(),
});

const lightScheduleResponseSchema = z.object({
  id: z.number().nullable(),
  created_at: z.number().nullable(),
  device_id: z.number(),
  active: z.boolean(),
  off_timestamp: z.number(),
  on_timestamp: z.number(),
});

const createDeviceRequestSchema = z.object({
  mac_address: z.string(),
  name: z.string().min(1),
});

const deviceSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
});

const createDeviceResponseSchema = z.object({
  device: deviceSummarySchema,
});

const deviceStateSchema = z.object({
  id: z.number(),
  created_at: z.number(),
  name: z.string(),
  mac_address: z.string(),
  last_seen: z.number().nullable(),
  online: z.boolean(),
  brightness: z.number().nullable(),
  temperature: z.number().nullable(),
  water_level: z.number().nullable(),
  light_schedule: lightScheduleSchema.nullable(),
  pump_schedule: pumpScheduleSchema.nullable(),
  lan_ip: z.string().nullable(),
  lan_ws_port: z.number().nullable(),
});

const deviceStateResponseSchema = z.object({
  state: deviceStateSchema,
});

const deviceListItemSchema = deviceStateSchema.omit({
  brightness: true,
  light_schedule: true,
});

const deviceListResponseSchema = z.object({
  devices: z.array(deviceListItemSchema),
});

type DeviceStateResponse = z.infer<typeof deviceStateResponseSchema>;

async function getDeviceMac(id: number, user_id: string) {
  const device = await db
    .selectFrom("devices")
    .select(["mac_address"])
    .where("id", "=", id)
    .where("user_id", "=", user_id)
    .executeTakeFirst();
  return device?.mac_address || null;
}

function toNumberOrNull(value?: string | null) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

const app = new Hono();

app
  .use("*", authMiddleware)
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
      const user = c.get("user");
      const { name, mac_address } = c.req.valid("json");

      const device = await db
        .insertInto("devices")
        .values({ name, mac_address, user_id: user.id })
        .returning(["id", "name"])
        .executeTakeFirstOrThrow();

      return c.json({ device });
    }
  )
  .delete(
    ":id",
    describeRoute({
      operationId: "deleteDevice",
      summary: "Delete a device",
      tags: ["Devices"],
      responses: {
        200: {
          description: "Device deleted successfully",
          content: {
            "application/json": {
              schema: resolver(deleteDeviceResponseSchema),
            },
          },
        },
        404: {
          description: "Device not found",
        },
      },
    }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) {
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device id" }, 400),
        });
      }

      // Fetch the MAC before deleting
      const device = await db
        .selectFrom("devices")
        .select(["id", "mac_address"])
        .where("id", "=", id)
        .where("user_id", "=", user.id)
        .executeTakeFirst();

      if (!device) {
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });
      }

      // Optionally, publish a "disconnect" or "delete" event over MQTT
      mqttClient.publish(`${device.mac_address}/device/command`, "delete");

      // Delete device
      await db.deleteFrom("devices").where("id", "=", id).execute();

      return c.json({ message: `Device ${id} deleted successfully` });
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
      const user = c.get("user");
      const id = Number(c.req.param("id"));

      if (isNaN(id)) {
        throw new HTTPException(400, {
          res: c.json({ message: "Device ID is required" }, 400),
        });
      }

      const device = await db
        .selectFrom("devices")
        .select([
          "id",
          "name",
          "created_at",
          "mac_address",
          "last_seen",
          "online",
          "lan_ip",
          "lan_ws_port",
        ])
        .where("user_id", "=", user.id)
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      if (!device) {
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });
      }

      const brightness = await db
        .selectFrom("device_timeseries as dt1")
        .select(["metric", "value_text", "value_type"])
        .where("mac_address", "=", device.mac_address)
        .where("metric", "in", ["light/brightness"])
        .orderBy("dt1.created_at", "desc") // or dt1.created_at if that’s the field
        .limit(1)
        .executeTakeFirst();

      const waterLevel = await db
        .selectFrom("device_timeseries as dt1")
        .select(["metric", "value_text", "value_type"])
        .where("mac_address", "=", device.mac_address)
        .where("metric", "in", ["water/level"])
        .orderBy("dt1.created_at", "desc") // or dt1.created_at if that’s the field
        .limit(1)
        .executeTakeFirst();

      const temperature = await db
        .selectFrom("device_timeseries as dt1")
        .select(["metric", "value_text", "value_type"])
        .where("mac_address", "=", device.mac_address)
        .where("metric", "in", ["temperature"])
        .orderBy("dt1.created_at", "desc") // or dt1.created_at if that’s the field
        .limit(1)
        .executeTakeFirst();

      const lightSchedule = await db
        .selectFrom("light_schedules")
        .selectAll()
        .where("device_id", "=", id)
        .limit(1)
        .executeTakeFirst();

      const pumpSchedule = await db
        .selectFrom("pump_schedules")
        .selectAll()
        .where("device_id", "=", id)
        .limit(1)
        .executeTakeFirst();

      return c.json({
        state: {
          ...device,
          online: Boolean(device.online),
          water_level: toNumberOrNull(waterLevel?.value_text),
          temperature: toNumberOrNull(temperature?.value_text),
          brightness: toNumberOrNull(brightness?.value_text),
          light_schedule: {
            on: lightSchedule?.on_timestamp || 0,
            off: lightSchedule?.off_timestamp || 0,
            active: Boolean(lightSchedule?.active),
          },
          pump_schedule: pumpSchedule
            ? {
                start_time: pumpSchedule.start_time,
                times_per_day: pumpSchedule.times_per_day,
                active: Boolean(pumpSchedule.active),
              }
            : {
                start_time: 0,
                times_per_day: 0,
                active: false,
              },
        },
      } satisfies DeviceStateResponse);
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
      const user = c.get("user");
      const devices = await db
        .selectFrom("devices")
        .select([
          "id",
          "name",
          "created_at",
          "mac_address",
          "last_seen",
          "online",
          "lan_ip",
          "lan_ws_port",
        ])
        .where("user_id", "=", user.id)
        .execute();

      return c.json({
        devices: devices.map((device) => ({
          ...device,
          online: Boolean(device.online),
        })),
      });
    }
  )
  .post(
    ":id/light/brightness",
    describeRoute({
      operationId: "setBrightness",
      summary: "Adjust the the brightness of the light",
      tags: ["Devices"],
    }),
    zValidator("json", lightToggleSchema),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));

      const mac = await getDeviceMac(id, user.id);

      if (!mac)
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });

      const { brightness } = c.req.valid("json");

      mqttClient.publish(
        `${mac}/sensor/light/brightness/command`,
        brightness.toString()
      );

      return c.json({ message: `Lights set to ${brightness}` });
    }
  )
  .post(
    ":id/light/schedule",
    describeRoute({
      operationId: "scheduleLight",
      summary: "Set a schedule for the light",
      tags: ["Devices"],
    }),
    zValidator("json", scheduleLightRequestSchema),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id))
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device id" }, 400),
        });

      const mac = await getDeviceMac(id, user.id);

      if (!mac)
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });

      const schedule = c.req.valid("json");

      if (schedule.active) {
        if (schedule.on === undefined || schedule.off === undefined) {
          const lightSchedule = await db
            .selectFrom("light_schedules")
            .selectAll()
            .where("device_id", "=", id)
            .limit(1)
            .executeTakeFirst();

          if (lightSchedule) {
            schedule.on = lightSchedule.on_timestamp;
            schedule.off = lightSchedule.off_timestamp;
          } else {
            schedule.on = 0;
            schedule.off = 0;
          }
        }

        setLightSchedule(mac, {
          onTimestamp: schedule.on,
          offTimestamp: schedule.off,
        });
      } else {
        removeLightSchedule(mac);
      }

      const existing = await db
        .selectFrom("light_schedules")
        .select("device_id")
        .where("device_id", "=", id)
        .executeTakeFirst();

      if (existing) {
        await db
          .updateTable("light_schedules")
          .where("device_id", "=", id)
          .set({
            active: schedule.active ? 1 : 0,
            on_timestamp: schedule.on,
            off_timestamp: schedule.off,
          })
          .execute();
      } else {
        await db
          .insertInto("light_schedules")
          .values({
            device_id: id,
            active: schedule.active ? 1 : 0,
            on_timestamp: schedule.on!,
            off_timestamp: schedule.off!,
          })
          .execute();
      }

      return c.json({ message: "Light schedule updated", schedule });
    }
  )
  .post(
    ":id/pump/schedule",
    describeRoute({
      operationId: "schedulePump",
      summary: "Set a schedule for the pump",
      tags: ["Devices"],
    }),
    zValidator("json", schedulePumpRequestSchema),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id))
        throw new HTTPException(400, {
          res: c.json({ message: "Invalid device id" }, 400),
        });

      const mac = await getDeviceMac(id, user.id);

      if (!mac)
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });

      const schedule = c.req.valid("json");

      const existingSchedule = await db
        .selectFrom("pump_schedules")
        .selectAll()
        .where("device_id", "=", id)
        .limit(1)
        .executeTakeFirst();

      if (schedule.active) {
        if (
          schedule.start_time === undefined ||
          schedule.times_per_day === undefined
        ) {
          if (existingSchedule) {
            schedule.start_time = existingSchedule.start_time;
            schedule.times_per_day = existingSchedule.times_per_day;
          } else {
            throw new HTTPException(400, {
              res: c.json(
                {
                  message:
                    "Start time and times per day are required to activate the pump schedule",
                },
                400
              ),
            });
          }
        }
      } else {
        removePumpSchedule(mac);
      }

      const persistedStartTime =
        schedule.start_time ?? existingSchedule?.start_time ?? Date.now();
      const persistedTimesPerDay =
        schedule.times_per_day ?? existingSchedule?.times_per_day ?? 1;

      if (schedule.active) {
        setPumpSchedule(mac, {
          startTime: persistedStartTime,
          timesPerDay: persistedTimesPerDay,
        });
      }

      if (existingSchedule) {
        await db
          .updateTable("pump_schedules")
          .where("device_id", "=", id)
          .set({
            active: schedule.active ? 1 : 0,
            start_time: persistedStartTime,
            times_per_day: persistedTimesPerDay,
          })
          .execute();
      } else {
        await db
          .insertInto("pump_schedules")
          .values({
            device_id: id,
            active: schedule.active ? 1 : 0,
            start_time: persistedStartTime,
            times_per_day: persistedTimesPerDay,
          })
          .execute();
      }

      return c.json({ message: "Pump schedule updated", schedule });
    }
  );

export default app;
