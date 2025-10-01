import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import { infer, z } from "zod";
import { db } from "../db";
import { mqttClient } from "../services/mqtt";

const deleteDeviceResponseSchema = z.object({
  message: z.string(),
});

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
  last_seen: z.number().nullable(),
  light: z.string().nullable(),
  light_schedule: lightScheduleSchema.nullable(),
  water_level: z.string().nullable(),
  number_of_plants: z.number(),
});

const deviceStateResponseSchema = z.object({
  state: deviceStateSchema,
});

const deviceListItemSchema = deviceStateSchema.omit({
  number_of_plants: true,
  light: true,
  light_schedule: true,
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
        .where("metric", "in", ["light", "light/schedule", "water_level"])
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

      const light = results.find((r) => r.metric === "light");
      const lightSchedule = results.find((r) => r.metric === "light/schedule");
      const waterLevel = results.find((r) => r.metric === "water_level");

      if (!device) {
        throw new HTTPException(404, {
          res: c.json({ message: "Device not found" }, 404),
        });
      }

      return c.json({
        state: {
          ...device,
          light: light ? light.value_text : null,
          light_schedule: lightSchedule
            ? JSON.parse(lightSchedule.value_text)
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
    ":id/light/toggle",
    describeRoute({
      operationId: "toggleLight",
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

      mqttClient.publish(`${mac}/light/command`, state);

      return c.json({ message: `Lights set to ${state}` });
    }
  )
  .post(
    ":id/light/schedule",
    describeRoute({
      operationId: "scheduleLight",
      summary: "Set a schedule for the light",
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
        `${mac}/light/schedule/command`,
        JSON.stringify(schedule)
      );

      return c.json({ message: "Light schedule updated", schedule });
    }
  );

export default app;
