import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import { z } from "zod";
import { db } from "../db";
import { mqttClient, sendWithAck } from "../services/mqtt";
import { SCHEDULE_DEFAULTS } from "../config/schedules";
import { authMiddleware } from "../middleware/auth-middleware";

// --- Schemas ---

const deleteDeviceResponseSchema = z.object({ message: z.string() });

const lightToggleSchema = z.object({
  brightness: z.number().min(0).max(100),
});

const scheduleSchema = z.object({
  active: z.boolean(),
  minutes_on: z.number().int().positive().optional(),
  minutes_off: z.number().int().positive().optional(),
});

const intervalScheduleSchema = z.object({
  active: z.boolean(),
  start_at: z.number(),
  start_off: z.boolean(),
  minutes_on: z.number(),
  minutes_off: z.number(),
});

const createDeviceRequestSchema = z.object({
  mac_address: z.string(),
  name: z.string().min(1),
});

const createDeviceResponseSchema = z.object({
  device: z.object({ id: z.number(), name: z.string() }),
});

const deviceStateSchema = z.object({
  id: z.number(),
  created_at: z.number(),
  name: z.string(),
  mac_address: z.string(),
  last_seen: z.number().nullable(),
  online: z.boolean(),
  brightness: z.number().nullable(),
  light_on: z.boolean().nullable(),
  temperature: z.number().nullable(),
  water_empty: z.boolean().nullable(),
  irrigation_on: z.boolean().nullable(),
  fan_on: z.boolean().nullable(),
  light_schedule: intervalScheduleSchema.nullable(),
  irrigation_schedule: intervalScheduleSchema.nullable(),
  fan_schedule: intervalScheduleSchema.nullable(),
  lan_ip: z.string().nullable(),
  lan_ws_port: z.number().nullable(),
});

const deviceStateResponseSchema = z.object({ state: deviceStateSchema });

const deviceListItemSchema = deviceStateSchema.omit({ brightness: true, light_on: true, light_schedule: true, irrigation_schedule: true, fan_schedule: true });
const deviceListResponseSchema = z.object({ devices: z.array(deviceListItemSchema) });

type DeviceStateResponse = z.infer<typeof deviceStateResponseSchema>;

// --- Helpers ---

async function getDeviceMac(id: number, user_id: string) {
  const device = await db
    .selectFrom("devices")
    .select(["mac_address"])
    .where("id", "=", id)
    .where("user_id", "=", user_id)
    .executeTakeFirst();
  return device?.mac_address ?? null;
}

/** Compute the current phase and end time given interval schedule params. */
function computePhase(start_at: number, start_off: boolean, minutes_on: number, minutes_off: number) {
  const now = Date.now();
  const onMs = minutes_on * 60 * 1000;
  const offMs = minutes_off * 60 * 1000;
  const cycleMs = onMs + offMs;
  const elapsed = now - start_at;
  const phaseMs = ((elapsed % cycleMs) + cycleMs) % cycleMs;

  let isOn: boolean;
  let phaseEndsAt: number;
  const cycleStart = now - phaseMs;

  if (start_off) {
    if (phaseMs < offMs) {
      isOn = false;
      phaseEndsAt = cycleStart + offMs;
    } else {
      isOn = true;
      phaseEndsAt = cycleStart + offMs + onMs;
    }
  } else {
    if (phaseMs < onMs) {
      isOn = true;
      phaseEndsAt = cycleStart + onMs;
    } else {
      isOn = false;
      phaseEndsAt = cycleStart + onMs + offMs;
    }
  }
  return { isOn, phaseEndsAt };
}

/** Dispatch a schedule command via MQTT and await ACK. Reverts DB on timeout. */
async function dispatchSchedule(
  mac: string,
  cmdType: string,
  payload: object,
  revert: () => Promise<void>
) {
  try {
    await sendWithAck(mac, cmdType, JSON.stringify(payload));
  } catch {
    console.warn(`[Schedule] ACK timeout for ${cmdType} on ${mac}, reverting.`);
    await revert();
    throw new HTTPException(504, { message: `Device did not acknowledge ${cmdType}` });
  }
}

const app = new Hono();

app
  .use("*", authMiddleware)

  // --- Device CRUD ---

  .post(
    "/create",
    describeRoute({
      operationId: "createDevice",
      summary: "Register a new device",
      tags: ["Devices"],
      responses: { 200: { description: "Device created", content: { "application/json": { schema: resolver(createDeviceResponseSchema) } } } },
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
        200: { description: "Device deleted successfully", content: { "application/json": { schema: resolver(deleteDeviceResponseSchema) } } },
        404: { description: "Device not found" },
      },
    }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const device = await db
        .selectFrom("devices")
        .select(["id", "mac_address"])
        .where("id", "=", id)
        .where("user_id", "=", user.id)
        .executeTakeFirst();

      if (!device) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      mqttClient.publish(`${device.mac_address}/device/command`, "delete");
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
      responses: { 200: { description: "Device state", content: { "application/json": { schema: resolver(deviceStateResponseSchema) } } } },
    }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Device ID is required" }, 400) });

      const device = await db
        .selectFrom("devices")
        .select(["id", "name", "created_at", "mac_address", "last_seen", "online", "lan_ip", "lan_ws_port"])
        .where("user_id", "=", user.id)
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      const [state, lightSchedule, irrigationSchedule, fanSchedule] =
        await Promise.all([
          db.selectFrom("device_state").selectAll().where("device_id", "=", id).executeTakeFirst(),
          db.selectFrom("light_schedules").selectAll().where("device_id", "=", id).executeTakeFirst(),
          db.selectFrom("irrigation_schedules").selectAll().where("device_id", "=", id).executeTakeFirst(),
          db.selectFrom("fan_schedules").selectAll().where("device_id", "=", id).executeTakeFirst(),
        ]);

      return c.json({
        state: {
          ...device,
          online: Boolean(device.online),
          brightness: state?.brightness ?? null,
          light_on: state ? Boolean(state.light_on) : null,
          temperature: state?.temperature ?? null,
          water_empty: state ? Boolean(state.water_empty) : null,
          irrigation_on: state ? Boolean(state.irrigation_on) : null,
          fan_on: state ? Boolean(state.fan_on) : null,
          light_schedule: lightSchedule
            ? { active: Boolean(lightSchedule.active), start_at: lightSchedule.start_at, start_off: Boolean(lightSchedule.start_off), minutes_on: lightSchedule.minutes_on, minutes_off: lightSchedule.minutes_off }
            : null,
          irrigation_schedule: irrigationSchedule
            ? { active: Boolean(irrigationSchedule.active), start_at: irrigationSchedule.start_at, start_off: Boolean(irrigationSchedule.start_off), minutes_on: irrigationSchedule.minutes_on, minutes_off: irrigationSchedule.minutes_off }
            : null,
          fan_schedule: fanSchedule
            ? { active: Boolean(fanSchedule.active), start_at: fanSchedule.start_at, start_off: Boolean(fanSchedule.start_off), minutes_on: fanSchedule.minutes_on, minutes_off: fanSchedule.minutes_off }
            : null,
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
      responses: { 200: { description: "Successful response", content: { "application/json": { schema: resolver(deviceListResponseSchema) } } } },
    }),
    async (c) => {
      const user = c.get("user");
      const devices = await db
        .selectFrom("devices")
        .select(["id", "name", "created_at", "mac_address", "last_seen", "online", "lan_ip", "lan_ws_port"])
        .where("user_id", "=", user.id)
        .execute();

      const states = await Promise.all(
        devices.map((d) =>
          db.selectFrom("device_state")
            .select(["water_empty", "irrigation_on", "fan_on", "temperature"])
            .where("device_id", "=", d.id)
            .executeTakeFirst()
        )
      );

      return c.json({
        devices: devices.map((d, i) => ({
          ...d,
          online: Boolean(d.online),
          water_empty: states[i] ? Boolean(states[i].water_empty) : null,
          irrigation_on: states[i] ? Boolean(states[i].irrigation_on) : null,
          fan_on: states[i] ? Boolean(states[i].fan_on) : null,
          temperature: states[i]?.temperature ?? null,
        })),
      });
    }
  )

  // --- Light ---

  .post(
    ":id/light/brightness",
    describeRoute({ operationId: "setBrightness", summary: "Adjust the brightness of the light", tags: ["Devices"] }),
    zValidator("json", lightToggleSchema),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const { brightness } = c.req.valid("json");
      mqttClient.publish(`ortus/${mac}/command`, JSON.stringify({ type: "setBrightness", value: brightness }));
      return c.json({ message: `Lights set to ${brightness}` });
    }
  )

  .post(
    ":id/light/schedule",
    describeRoute({ operationId: "scheduleLight", summary: "Start or pause the light schedule", tags: ["Devices"] }),
    zValidator("json", scheduleSchema),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const { active, minutes_on, minutes_off } = c.req.valid("json");
      const existing = await db.selectFrom("light_schedules").selectAll().where("device_id", "=", id).executeTakeFirst();

      const resolvedOn = minutes_on ?? existing?.minutes_on ?? SCHEDULE_DEFAULTS.light.minutes_on;
      const resolvedOff = minutes_off ?? existing?.minutes_off ?? SCHEDULE_DEFAULTS.light.minutes_off;
      const now = Date.now();

      if (existing) {
        const prev = { active: existing.active, start_at: existing.start_at, start_off: existing.start_off };
        await db.updateTable("light_schedules").where("device_id", "=", id)
          .set({ active: active ? 1 : 0, minutes_on: resolvedOn, minutes_off: resolvedOff, ...(active ? { start_at: now, start_off: 0 } : {}) })
          .execute();
        await dispatchSchedule(mac, "setLightSchedule",
          { type: "setLightSchedule", active, minutes_on: resolvedOn, minutes_off: resolvedOff, start_off: false, start_at: Math.floor(now / 1000) },
          async () => {
            await db.updateTable("light_schedules").where("device_id", "=", id)
              .set({ active: prev.active, start_at: prev.start_at, start_off: prev.start_off })
              .execute();
          }
        );
      } else {
        await db.insertInto("light_schedules")
          .values({ device_id: id, active: active ? 1 : 0, minutes_on: resolvedOn, minutes_off: resolvedOff, ...(active ? { start_at: now, start_off: 0 } : {}) })
          .execute();
        await dispatchSchedule(mac, "setLightSchedule",
          { type: "setLightSchedule", active, minutes_on: resolvedOn, minutes_off: resolvedOff, start_off: false, start_at: Math.floor(now / 1000) },
          async () => {
            await db.deleteFrom("light_schedules").where("device_id", "=", id).execute();
          }
        );
      }

      return c.json({ message: "Light schedule updated" });
    }
  )

  .post(
    ":id/light/schedule/skip",
    describeRoute({ operationId: "skipLightSchedule", summary: "Skip the current light phase", tags: ["Devices"] }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const schedule = await db.selectFrom("light_schedules").selectAll().where("device_id", "=", id).executeTakeFirst();
      if (!schedule || !schedule.active) throw new HTTPException(400, { res: c.json({ message: "No active light schedule" }, 400) });

      const { isOn } = computePhase(schedule.start_at, Boolean(schedule.start_off), schedule.minutes_on, schedule.minutes_off);
      // Skip current phase: if ON → jump to OFF, if OFF → jump to ON
      const newStartOff = isOn ? 1 : 0;
      const prevStartAt = schedule.start_at;
      const prevStartOff = schedule.start_off;
      const now = Date.now();

      await db.updateTable("light_schedules").where("device_id", "=", id)
        .set({ start_at: now, start_off: newStartOff })
        .execute();

      await dispatchSchedule(mac, "setLightSchedule",
        { type: "setLightSchedule", active: true, minutes_on: schedule.minutes_on, minutes_off: schedule.minutes_off, start_off: Boolean(newStartOff), start_at: Math.floor(now / 1000) },
        async () => {
          await db.updateTable("light_schedules").where("device_id", "=", id)
            .set({ start_at: prevStartAt, start_off: prevStartOff })
            .execute();
        }
      );

      return c.json({ message: "Light schedule skipped" });
    }
  )

  .post(
    ":id/light/schedule/restart",
    describeRoute({ operationId: "restartLightSchedule", summary: "Restart the light schedule (starts ON phase immediately)", tags: ["Devices"] }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const existing = await db.selectFrom("light_schedules").selectAll().where("device_id", "=", id).executeTakeFirst();
      if (!existing) throw new HTTPException(400, { res: c.json({ message: "No light schedule to restart" }, 400) });

      const now = Date.now();
      const prev = { active: existing.active, start_at: existing.start_at, start_off: existing.start_off };

      await db.updateTable("light_schedules").where("device_id", "=", id)
        .set({ active: 1, start_at: now, start_off: 0 })
        .execute();

      await dispatchSchedule(mac, "setLightSchedule",
        { type: "setLightSchedule", active: true, minutes_on: existing.minutes_on, minutes_off: existing.minutes_off, start_off: false, start_at: Math.floor(now / 1000) },
        async () => {
          await db.updateTable("light_schedules").where("device_id", "=", id)
            .set({ active: prev.active, start_at: prev.start_at, start_off: prev.start_off })
            .execute();
        }
      );

      return c.json({ message: "Light schedule restarted" });
    }
  )

  // --- Irrigation ---

  .post(
    ":id/irrigation/schedule",
    describeRoute({ operationId: "scheduleIrrigation", summary: "Start or pause the irrigation schedule", tags: ["Devices"] }),
    zValidator("json", scheduleSchema),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const { active, minutes_on, minutes_off } = c.req.valid("json");
      const existing = await db.selectFrom("irrigation_schedules").selectAll().where("device_id", "=", id).executeTakeFirst();

      const resolvedOn = minutes_on ?? existing?.minutes_on ?? SCHEDULE_DEFAULTS.irrigation.minutes_on;
      const resolvedOff = minutes_off ?? existing?.minutes_off ?? SCHEDULE_DEFAULTS.irrigation.minutes_off;
      // Irrigation starts in OFF phase by default (start_off=1) so first action is to water
      const initialStartOff = 1;
      const now = Date.now();

      if (existing) {
        const prev = { active: existing.active, start_at: existing.start_at, start_off: existing.start_off };
        await db.updateTable("irrigation_schedules").where("device_id", "=", id)
          .set({ active: active ? 1 : 0, minutes_on: resolvedOn, minutes_off: resolvedOff, ...(active ? { start_at: now, start_off: initialStartOff } : {}) })
          .execute();
        await dispatchSchedule(mac, "setIrrigationSchedule",
          { type: "setIrrigationSchedule", active, minutes_on: resolvedOn, minutes_off: resolvedOff, start_off: Boolean(initialStartOff), start_at: Math.floor(now / 1000) },
          async () => {
            await db.updateTable("irrigation_schedules").where("device_id", "=", id)
              .set({ active: prev.active, start_at: prev.start_at, start_off: prev.start_off })
              .execute();
          }
        );
      } else {
        await db.insertInto("irrigation_schedules")
          .values({ device_id: id, active: active ? 1 : 0, minutes_on: resolvedOn, minutes_off: resolvedOff, ...(active ? { start_at: now, start_off: initialStartOff } : {}) })
          .execute();
        await dispatchSchedule(mac, "setIrrigationSchedule",
          { type: "setIrrigationSchedule", active, minutes_on: resolvedOn, minutes_off: resolvedOff, start_off: Boolean(initialStartOff), start_at: Math.floor(now / 1000) },
          async () => {
            await db.deleteFrom("irrigation_schedules").where("device_id", "=", id).execute();
          }
        );
      }

      return c.json({ message: "Irrigation schedule updated" });
    }
  )

  .post(
    ":id/irrigation/schedule/skip",
    describeRoute({ operationId: "skipIrrigationSchedule", summary: "Skip the current irrigation phase", tags: ["Devices"] }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const schedule = await db.selectFrom("irrigation_schedules").selectAll().where("device_id", "=", id).executeTakeFirst();
      if (!schedule || !schedule.active) throw new HTTPException(400, { res: c.json({ message: "No active irrigation schedule" }, 400) });

      const { isOn } = computePhase(schedule.start_at, Boolean(schedule.start_off), schedule.minutes_on, schedule.minutes_off);
      const newStartOff = isOn ? 1 : 0;
      const prevStartAt = schedule.start_at;
      const prevStartOff = schedule.start_off;
      const now = Date.now();

      await db.updateTable("irrigation_schedules").where("device_id", "=", id)
        .set({ start_at: now, start_off: newStartOff, skipped_at: now })
        .execute();

      await dispatchSchedule(mac, "setIrrigationSchedule",
        { type: "setIrrigationSchedule", active: true, minutes_on: schedule.minutes_on, minutes_off: schedule.minutes_off, start_off: Boolean(newStartOff), start_at: Math.floor(now / 1000) },
        async () => {
          await db.updateTable("irrigation_schedules").where("device_id", "=", id)
            .set({ start_at: prevStartAt, start_off: prevStartOff, skipped_at: null })
            .execute();
        }
      );

      return c.json({ message: "Irrigation schedule skipped" });
    }
  )

  .post(
    ":id/irrigation/schedule/restart",
    describeRoute({ operationId: "restartIrrigationSchedule", summary: "Restart the irrigation schedule (starts watering immediately)", tags: ["Devices"] }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const existing = await db.selectFrom("irrigation_schedules").selectAll().where("device_id", "=", id).executeTakeFirst();
      if (!existing) throw new HTTPException(400, { res: c.json({ message: "No irrigation schedule to restart" }, 400) });

      const now = Date.now();
      const prev = { active: existing.active, start_at: existing.start_at, start_off: existing.start_off };

      // Restarting always resets to starting now and starting ON (watering)
      await db.updateTable("irrigation_schedules").where("device_id", "=", id)
        .set({ active: 1, start_at: now, start_off: 0 })
        .execute();

      await dispatchSchedule(mac, "setIrrigationSchedule",
        { type: "setIrrigationSchedule", active: true, minutes_on: existing.minutes_on, minutes_off: existing.minutes_off, start_off: false, start_at: Math.floor(now / 1000) },
        async () => {
          await db.updateTable("irrigation_schedules").where("device_id", "=", id)
            .set({ active: prev.active, start_at: prev.start_at, start_off: prev.start_off })
            .execute();
        }
      );

      return c.json({ message: "Irrigation schedule restarted" });
    }
  )

  // --- Fan ---

  .post(
    ":id/fan/schedule",
    describeRoute({ operationId: "scheduleFan", summary: "Start or pause the fan schedule", tags: ["Devices"] }),
    zValidator("json", scheduleSchema),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const { active, minutes_on, minutes_off } = c.req.valid("json");
      const existing = await db.selectFrom("fan_schedules").selectAll().where("device_id", "=", id).executeTakeFirst();

      const resolvedOn = minutes_on ?? existing?.minutes_on ?? SCHEDULE_DEFAULTS.fan.minutes_on;
      const resolvedOff = minutes_off ?? existing?.minutes_off ?? SCHEDULE_DEFAULTS.fan.minutes_off;
      const now = Date.now();

      if (existing) {
        const prev = { active: existing.active, start_at: existing.start_at, start_off: existing.start_off };
        await db.updateTable("fan_schedules").where("device_id", "=", id)
          .set({ active: active ? 1 : 0, minutes_on: resolvedOn, minutes_off: resolvedOff, ...(active ? { start_at: now, start_off: 0 } : {}) })
          .execute();
        await dispatchSchedule(mac, "setFanSchedule",
          { type: "setFanSchedule", active, minutes_on: resolvedOn, minutes_off: resolvedOff, start_off: false, start_at: Math.floor(now / 1000) },
          async () => {
            await db.updateTable("fan_schedules").where("device_id", "=", id)
              .set({ active: prev.active, start_at: prev.start_at, start_off: prev.start_off })
              .execute();
          }
        );
      } else {
        await db.insertInto("fan_schedules")
          .values({ device_id: id, active: active ? 1 : 0, minutes_on: resolvedOn, minutes_off: resolvedOff, ...(active ? { start_at: now, start_off: 0 } : {}) })
          .execute();
        await dispatchSchedule(mac, "setFanSchedule",
          { type: "setFanSchedule", active, minutes_on: resolvedOn, minutes_off: resolvedOff, start_off: false, start_at: Math.floor(now / 1000) },
          async () => {
            await db.deleteFrom("fan_schedules").where("device_id", "=", id).execute();
          }
        );
      }

      return c.json({ message: "Fan schedule updated" });
    }
  )

  .post(
    ":id/fan/schedule/skip",
    describeRoute({ operationId: "skipFanSchedule", summary: "Skip the current fan phase", tags: ["Devices"] }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Invalid device id" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const schedule = await db.selectFrom("fan_schedules").selectAll().where("device_id", "=", id).executeTakeFirst();
      if (!schedule || !schedule.active) throw new HTTPException(400, { res: c.json({ message: "No active fan schedule" }, 400) });

      const { isOn } = computePhase(schedule.start_at, Boolean(schedule.start_off), schedule.minutes_on, schedule.minutes_off);
      const newStartOff = isOn ? 1 : 0;
      const prevStartAt = schedule.start_at;
      const prevStartOff = schedule.start_off;
      const now = Date.now();

      await db.updateTable("fan_schedules").where("device_id", "=", id)
        .set({ start_at: now, start_off: newStartOff })
        .execute();

      await dispatchSchedule(mac, "setFanSchedule",
        { type: "setFanSchedule", active: true, minutes_on: schedule.minutes_on, minutes_off: schedule.minutes_off, start_off: Boolean(newStartOff), start_at: Math.floor(now / 1000) },
        async () => {
          await db.updateTable("fan_schedules").where("device_id", "=", id)
            .set({ start_at: prevStartAt, start_off: prevStartOff })
            .execute();
        }
      );

      return c.json({ message: "Fan schedule skipped" });
    }
  );

export default app;
