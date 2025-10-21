import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import { infer, z } from "zod";
import { db } from "../db";
import { mqttClient } from "../services/mqtt";
import { removeLightSchedule, setLightSchedule } from "../cron";

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
  created_at: z.number(),
  name: z.string(),
  mac_address: z.string(),
  organization_id: z.number(),
  last_seen: z.number().nullable(),
  online: z.boolean(),
  brightness: z.number().nullable(),
  light_schedule: lightScheduleSchema.nullable(),
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

      const device = await db
        .insertInto("devices")
        .values({ name, mac_address, organization_id })
        .returning(["id", "name", "organization_id"])
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
          "organization_id",
          "last_seen",
          "online",
          "lan_ip",
          "lan_ws_port",
        ])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      const brightness = await db
        .selectFrom("device_timeseries as dt1")
        .select(["metric", "value_text", "value_type"])
        .where("mac_address", "=", device.mac_address)
        .where("metric", "in", ["light/brightness"])
        .orderBy("dt1.created_at", "desc") // or dt1.created_at if that’s the field
        .limit(1)
        .executeTakeFirst();

      const lightSchedule = await db
        .selectFrom("light_schedules")
        .selectAll()
        .where("device_id", "=", id)
        .limit(1)
        .executeTakeFirst();

      if (!device) {
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });
      }

      return c.json({
        state: {
          ...device,
          online: Boolean(device.online),
          brightness: Number(brightness?.value_text) || null,
          light_schedule: {
            on: lightSchedule?.on_timestamp || 0,
            off: lightSchedule?.off_timestamp || 0,
            active: Boolean(lightSchedule?.active),
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
      const devices = await db
        .selectFrom("devices")
        .select([
          "id",
          "name",
          "created_at",
          "mac_address",
          "organization_id",
          "last_seen",
          "online",
          "lan_ip",
          "lan_ws_port",
        ])
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

      const { brightness } = c.req.valid("json");

      console.log({ brightness });

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
  );

export default app;
