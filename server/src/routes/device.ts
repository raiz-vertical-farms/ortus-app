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
  light_schedule: intervalScheduleSchema.nullable(),
  irrigation_schedule: intervalScheduleSchema.nullable(),
  lan_ip: z.string().nullable(),
  lan_ws_port: z.number().nullable(),
});

const deviceStateResponseSchema = z.object({ state: deviceStateSchema });

const deviceListItemSchema = deviceStateSchema.omit({ brightness: true, light_on: true, light_schedule: true, irrigation_schedule: true });
const deviceListResponseSchema = z.object({ devices: z.array(deviceListItemSchema) });

const stateHistoryItemSchema = z.object({
  id: z.number(),
  brightness: z.number(),
  light_on: z.boolean(),
  irrigation_on: z.boolean(),
  temperature: z.number().nullable(),
  water_empty: z.boolean(),
  recorded_at: z.number(),
});
const stateHistoryResponseSchema = z.object({ history: z.array(stateHistoryItemSchema) });

const deviceLogItemSchema = z.object({
  id: z.number(),
  level: z.string(),
  tag: z.string(),
  message: z.string(),
  recorded_at: z.number(),
});
const deviceLogsResponseSchema = z.object({ logs: z.array(deviceLogItemSchema) });

type DeviceStateResponse = z.infer<typeof deviceStateResponseSchema>;

function parseLimit(raw: string | undefined, fallback = 20, max = 200) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

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

// --- Schedule read/write via device_state ---
//
// device_state is the only place schedules live. Reads convert the DB's
// seconds back to the API's minutes / millisecond start_at so the frontend
// contract is unchanged. start_off is server-tracked (firmware doesn't echo
// it) — preserved across mqtt state broadcasts via the omit-if-missing
// logic in services/mqtt.ts.

type SchedulePatch = {
  active?: boolean;
  minutes_on?: number;
  minutes_off?: number;
  start_at_ms?: number;
  start_off?: boolean;
};

type ScheduleRead = {
  active: number;
  minutes_on: number;
  minutes_off: number;
  start_at: number; // ms
  start_off: number;
};

async function getLightSchedule(deviceId: number): Promise<ScheduleRead | null> {
  const row = await db.selectFrom("device_state")
    .select(["light_schedule_active", "light_on_seconds", "light_off_seconds", "light_start_at", "light_start_off"])
    .where("device_id", "=", deviceId)
    .executeTakeFirst();
  if (!row) return null;
  // No schedule has ever been configured — distinguish from a paused-but-configured schedule.
  if (row.light_on_seconds === 0 && row.light_off_seconds === 0) return null;
  return {
    active: row.light_schedule_active,
    minutes_on: Math.floor(row.light_on_seconds / 60),
    minutes_off: Math.floor(row.light_off_seconds / 60),
    start_at: row.light_start_at * 1000,
    start_off: row.light_start_off,
  };
}

async function getIrrigationSchedule(deviceId: number): Promise<ScheduleRead | null> {
  const row = await db.selectFrom("device_state")
    .select(["irrigation_schedule_active", "irrigation_on_seconds", "irrigation_off_seconds", "irrigation_start_at", "irrigation_start_off"])
    .where("device_id", "=", deviceId)
    .executeTakeFirst();
  if (!row) return null;
  if (row.irrigation_on_seconds === 0 && row.irrigation_off_seconds === 0) return null;
  return {
    active: row.irrigation_schedule_active,
    minutes_on: Math.floor(row.irrigation_on_seconds / 60),
    minutes_off: Math.floor(row.irrigation_off_seconds / 60),
    start_at: row.irrigation_start_at * 1000,
    start_off: row.irrigation_start_off,
  };
}

async function setLightSchedule(deviceId: number, patch: SchedulePatch) {
  const set = {
    ...(patch.active !== undefined && { light_schedule_active: patch.active ? 1 : 0 }),
    ...(patch.minutes_on !== undefined && { light_on_seconds: patch.minutes_on * 60 }),
    ...(patch.minutes_off !== undefined && { light_off_seconds: patch.minutes_off * 60 }),
    ...(patch.start_at_ms !== undefined && { light_start_at: Math.floor(patch.start_at_ms / 1000) }),
    ...(patch.start_off !== undefined && { light_start_off: patch.start_off ? 1 : 0 }),
  };
  await db.insertInto("device_state")
    .values({ device_id: deviceId, ...set })
    .onConflict((oc) => oc.column("device_id").doUpdateSet(set))
    .execute();
}

async function setIrrigationSchedule(deviceId: number, patch: SchedulePatch) {
  const set = {
    ...(patch.active !== undefined && { irrigation_schedule_active: patch.active ? 1 : 0 }),
    ...(patch.minutes_on !== undefined && { irrigation_on_seconds: patch.minutes_on * 60 }),
    ...(patch.minutes_off !== undefined && { irrigation_off_seconds: patch.minutes_off * 60 }),
    ...(patch.start_at_ms !== undefined && { irrigation_start_at: Math.floor(patch.start_at_ms / 1000) }),
    ...(patch.start_off !== undefined && { irrigation_start_off: patch.start_off ? 1 : 0 }),
  };
  await db.insertInto("device_state")
    .values({ device_id: deviceId, ...set })
    .onConflict((oc) => oc.column("device_id").doUpdateSet(set))
    .execute();
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

      mqttClient.publish(`ortus/${device.mac_address}/command`, "delete");
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

      const [state, lightSchedule, irrigationSchedule] =
        await Promise.all([
          db.selectFrom("device_state").selectAll().where("device_id", "=", id).executeTakeFirst(),
          getLightSchedule(id),
          getIrrigationSchedule(id),
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
          light_schedule: lightSchedule
            ? { active: Boolean(lightSchedule.active), start_at: lightSchedule.start_at, start_off: Boolean(lightSchedule.start_off), minutes_on: lightSchedule.minutes_on, minutes_off: lightSchedule.minutes_off }
            : null,
          irrigation_schedule: irrigationSchedule
            ? { active: Boolean(irrigationSchedule.active), start_at: irrigationSchedule.start_at, start_off: Boolean(irrigationSchedule.start_off), minutes_on: irrigationSchedule.minutes_on, minutes_off: irrigationSchedule.minutes_off }
            : null,
        },
      } satisfies DeviceStateResponse);
    }
  )

  .get(
    ":id/history",
    describeRoute({
      operationId: "deviceHistory",
      summary: "Recent state changes for a device (most recent first)",
      tags: ["Devices"],
      responses: { 200: { description: "State history", content: { "application/json": { schema: resolver(stateHistoryResponseSchema) } } } },
    }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Device ID is required" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const limit = parseLimit(c.req.query("limit"));
      const rows = await db
        .selectFrom("device_state_history")
        .select(["id", "brightness", "light_on", "irrigation_on", "temperature", "water_empty", "recorded_at"])
        .where("device_id", "=", id)
        .orderBy("recorded_at", "desc")
        .limit(limit)
        .execute();

      return c.json({
        history: rows.map((r) => ({
          id: r.id,
          brightness: r.brightness,
          light_on: Boolean(r.light_on),
          irrigation_on: Boolean(r.irrigation_on),
          temperature: r.temperature,
          water_empty: Boolean(r.water_empty),
          recorded_at: r.recorded_at,
        })),
      });
    }
  )

  .get(
    ":id/logs",
    describeRoute({
      operationId: "deviceLogs",
      summary: "Recent debug logs for a device (most recent first)",
      tags: ["Devices"],
      responses: { 200: { description: "Device logs", content: { "application/json": { schema: resolver(deviceLogsResponseSchema) } } } },
    }),
    async (c) => {
      const user = c.get("user");
      const id = Number(c.req.param("id"));
      if (isNaN(id)) throw new HTTPException(400, { res: c.json({ message: "Device ID is required" }, 400) });

      const mac = await getDeviceMac(id, user.id);
      if (!mac) throw new HTTPException(404, { res: c.json({ message: "Device not found" }, 404) });

      const limit = parseLimit(c.req.query("limit"));
      const rows = await db
        .selectFrom("device_logs")
        .select(["id", "level", "tag", "message", "recorded_at"])
        .where("device_id", "=", id)
        .orderBy("recorded_at", "desc")
        .limit(limit)
        .execute();

      return c.json({ logs: rows });
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
            .select(["water_empty", "irrigation_on", "temperature"])
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
      const existing = await getLightSchedule(id);

      const resolvedOn = minutes_on ?? existing?.minutes_on ?? SCHEDULE_DEFAULTS.light.minutes_on;
      const resolvedOff = minutes_off ?? existing?.minutes_off ?? SCHEDULE_DEFAULTS.light.minutes_off;
      const now = Date.now();

      const patch: SchedulePatch = {
        active,
        minutes_on: resolvedOn,
        minutes_off: resolvedOff,
        ...(active ? { start_at_ms: now, start_off: false } : {}),
      };
      await setLightSchedule(id, patch);

      await dispatchSchedule(mac, "setLightSchedule",
        { type: "setLightSchedule", active, minutes_on: resolvedOn, minutes_off: resolvedOff, start_off: false, start_at: Math.floor(now / 1000) },
        async () => {
          if (existing) {
            await setLightSchedule(id, {
              active: Boolean(existing.active),
              minutes_on: existing.minutes_on,
              minutes_off: existing.minutes_off,
              start_at_ms: existing.start_at,
              start_off: Boolean(existing.start_off),
            });
          } else {
            await setLightSchedule(id, { active: false, minutes_on: 0, minutes_off: 0, start_at_ms: 0, start_off: false });
          }
        }
      );

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

      const schedule = await getLightSchedule(id);
      if (!schedule || !schedule.active) throw new HTTPException(400, { res: c.json({ message: "No active light schedule" }, 400) });

      const { isOn } = computePhase(schedule.start_at, Boolean(schedule.start_off), schedule.minutes_on, schedule.minutes_off);
      // Skip current phase: if ON → jump to OFF, if OFF → jump to ON
      const newStartOff = isOn;
      const prevStartAt = schedule.start_at;
      const prevStartOff = Boolean(schedule.start_off);
      const now = Date.now();

      await setLightSchedule(id, { start_at_ms: now, start_off: newStartOff });

      await dispatchSchedule(mac, "setLightSchedule",
        { type: "setLightSchedule", active: true, minutes_on: schedule.minutes_on, minutes_off: schedule.minutes_off, start_off: newStartOff, start_at: Math.floor(now / 1000) },
        async () => {
          await setLightSchedule(id, { start_at_ms: prevStartAt, start_off: prevStartOff });
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

      const existing = await getLightSchedule(id);
      if (!existing) throw new HTTPException(400, { res: c.json({ message: "No light schedule to restart" }, 400) });

      const now = Date.now();
      const prev = { active: Boolean(existing.active), start_at_ms: existing.start_at, start_off: Boolean(existing.start_off) };

      await setLightSchedule(id, { active: true, start_at_ms: now, start_off: false });

      await dispatchSchedule(mac, "setLightSchedule",
        { type: "setLightSchedule", active: true, minutes_on: existing.minutes_on, minutes_off: existing.minutes_off, start_off: false, start_at: Math.floor(now / 1000) },
        async () => {
          await setLightSchedule(id, prev);
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
      const existing = await getIrrigationSchedule(id);

      const resolvedOn = minutes_on ?? existing?.minutes_on ?? SCHEDULE_DEFAULTS.irrigation.minutes_on;
      const resolvedOff = minutes_off ?? existing?.minutes_off ?? SCHEDULE_DEFAULTS.irrigation.minutes_off;
      // Irrigation starts in OFF phase by default (start_off=true) so first action is to water
      const initialStartOff = true;
      const now = Date.now();

      const patch: SchedulePatch = {
        active,
        minutes_on: resolvedOn,
        minutes_off: resolvedOff,
        ...(active ? { start_at_ms: now, start_off: initialStartOff } : {}),
      };
      await setIrrigationSchedule(id, patch);

      await dispatchSchedule(mac, "setIrrigationSchedule",
        { type: "setIrrigationSchedule", active, minutes_on: resolvedOn, minutes_off: resolvedOff, start_off: initialStartOff, start_at: Math.floor(now / 1000) },
        async () => {
          if (existing) {
            await setIrrigationSchedule(id, {
              active: Boolean(existing.active),
              minutes_on: existing.minutes_on,
              minutes_off: existing.minutes_off,
              start_at_ms: existing.start_at,
              start_off: Boolean(existing.start_off),
            });
          } else {
            await setIrrigationSchedule(id, { active: false, minutes_on: 0, minutes_off: 0, start_at_ms: 0, start_off: false });
          }
        }
      );

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

      const schedule = await getIrrigationSchedule(id);
      if (!schedule || !schedule.active) throw new HTTPException(400, { res: c.json({ message: "No active irrigation schedule" }, 400) });

      const { isOn } = computePhase(schedule.start_at, Boolean(schedule.start_off), schedule.minutes_on, schedule.minutes_off);
      const newStartOff = isOn;
      const prevStartAt = schedule.start_at;
      const prevStartOff = Boolean(schedule.start_off);
      const now = Date.now();

      await setIrrigationSchedule(id, { start_at_ms: now, start_off: newStartOff });

      await dispatchSchedule(mac, "setIrrigationSchedule",
        { type: "setIrrigationSchedule", active: true, minutes_on: schedule.minutes_on, minutes_off: schedule.minutes_off, start_off: newStartOff, start_at: Math.floor(now / 1000) },
        async () => {
          await setIrrigationSchedule(id, { start_at_ms: prevStartAt, start_off: prevStartOff });
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

      const existing = await getIrrigationSchedule(id);
      if (!existing) throw new HTTPException(400, { res: c.json({ message: "No irrigation schedule to restart" }, 400) });

      const now = Date.now();
      const prev = { active: Boolean(existing.active), start_at_ms: existing.start_at, start_off: Boolean(existing.start_off) };

      // Restarting always resets to starting now and starting ON (watering)
      await setIrrigationSchedule(id, { active: true, start_at_ms: now, start_off: false });

      await dispatchSchedule(mac, "setIrrigationSchedule",
        { type: "setIrrigationSchedule", active: true, minutes_on: existing.minutes_on, minutes_off: existing.minutes_off, start_off: false, start_at: Math.floor(now / 1000) },
        async () => {
          await setIrrigationSchedule(id, prev);
        }
      );

      return c.json({ message: "Irrigation schedule restarted" });
    }
  );

export default app;
