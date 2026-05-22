import mqtt, { MqttClient } from "mqtt";
import { z } from "zod";
import { db } from "../db";
import { ACK_TIMEOUT_MS } from "../config/schedules";

const MQTT_CONFIG = {
  url: `mqtts://${process.env.MQTT_BROKER_HOST}:8883`,
  options: {
    username: process.env.MQTT_USERNAME!,
    password: process.env.MQTT_PASSWORD!,
  },
  subscriptions: ["ortus/+/presence", "ortus/+/state", "ortus/+/status", "ortus/+/ack", "ortus/+/log"],
};

export const mqttClient: MqttClient = mqtt.connect(
  MQTT_CONFIG.url,
  MQTT_CONFIG.options
);

// READ_ONLY mode: blocks every outbound publish so a dev server can safely
// shadow-subscribe to a production device without sending commands to it.
// All inbound message handling is unaffected — only `mqttClient.publish` is.
if (process.env.READ_ONLY === "true") {
  console.warn("⚠️  READ_ONLY=true — all outbound MQTT publishes are blocked.");
  const originalPublish = mqttClient.publish.bind(mqttClient);
  mqttClient.publish = function (this: MqttClient, topic: any, ...rest: any[]) {
    console.warn(`[READ_ONLY] Blocked publish to ${topic}`);
    // mqtt.js callbacks can be the last arg — invoke with null error so awaiting
    // callers don't hang. sendWithAck will still time out waiting for the device
    // ACK, which is the correct UX: the user finds out the click was dropped.
    const cb = rest[rest.length - 1];
    if (typeof cb === "function") cb(null);
    return mqttClient;
  } as typeof mqttClient.publish;
  // Keep the no-op active even if the underlying client reconnects.
  void originalPublish;
}

console.log("Connecting to MQTT broker...");

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");
  MQTT_CONFIG.subscriptions.forEach((topic) =>
    mqttClient.subscribe(topic, (err) =>
      err
        ? console.error(`❌ Failed to subscribe ${topic}:`, err)
        : console.log(`✅ Subscribed to ${topic}`)
    )
  );
});

// --- ACK pattern ---

type PendingAck = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingAcks = new Map<string, PendingAck>();

/**
 * Publishes an MQTT command and waits for an ACK from the device.
 * If no ACK is received within `timeoutMs`, rejects with an error.
 */
export function sendWithAck(
  mac: string,
  cmdType: string,
  payload: string,
  timeoutMs = ACK_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const key = `${mac}:${cmdType}`;
    const timer = setTimeout(() => {
      pendingAcks.delete(key);
      reject(new Error(`ACK timeout for ${cmdType} on ${mac}`));
    }, timeoutMs);
    pendingAcks.set(key, { resolve, reject, timer });
    mqttClient.publish(`ortus/${mac}/command`, payload);
  });
}

// --- Message schemas ---

const presenceSchema = z.object({
  ip: z.string().optional(),
  mac: z.string(),
  uptime: z.number().optional(),
});

const stateSchema = z.object({
  brightness: z.number().optional(),
  lightOn: z.boolean().optional(),
  lightScheduleActive: z.boolean().optional(),
  irrigationOn: z.boolean().optional(),
  irrigationScheduleActive: z.boolean().optional(),
  temperature: z.number().nullable().optional(),
  waterEmpty: z.boolean().optional(),
  // Schedule details — only sent by firmware that's been OTA'd in Phase 2.
  // When absent we preserve the existing device_state values rather than
  // zeroing them, so old firmware doesn't wipe the backfilled schedule.
  lightScheduleOnSeconds: z.number().int().nonnegative().optional(),
  lightScheduleOffSeconds: z.number().int().nonnegative().optional(),
  lightScheduleStartEpoch: z.number().int().nonnegative().optional(),
  irrigationScheduleOnSeconds: z.number().int().nonnegative().optional(),
  irrigationScheduleOffSeconds: z.number().int().nonnegative().optional(),
  irrigationScheduleStartEpoch: z.number().int().nonnegative().optional(),
});

const logSchema = z.object({
  level: z.enum(["info", "warn", "error"]).default("info"),
  tag: z.string().max(32).default("device"),
  message: z.string().max(500),
});

type PresencePayload = z.infer<typeof presenceSchema>;
type StatePayload = z.infer<typeof stateSchema>;
type LogPayload = z.infer<typeof logSchema>;

function safeJSON<T>(str: string): T | undefined {
  try {
    return JSON.parse(str) as T;
  } catch {
    return undefined;
  }
}

mqttClient.on("message", async (topic, payload) => {
  try {
    const raw = payload.toString();
    const parts = topic.split("/");
    if (parts.length !== 3 || parts[0] !== "ortus") return;

    const mac = parts[1];
    const type = parts[2];

    if (type === "status") {
      const isOnline = raw === "online";
      await db
        .updateTable("devices")
        .set({
          online: isOnline ? 1 : 0,
          ...(isOnline ? {} : { last_seen: Math.floor(Date.now() / 1000) }),
        })
        .where("mac_address", "=", mac)
        .execute();
      console.log(`[Status] ${mac} is ${raw}`);
    } else if (type === "presence") {
      const data = safeJSON<PresencePayload>(raw);
      if (!data) return;
      await db
        .updateTable("devices")
        .set({ online: 1, last_seen: Math.floor(Date.now() / 1000), lan_ip: data.ip })
        .where("mac_address", "=", mac)
        .execute();
      console.log(`[Presence] ${mac} is online at ${data.ip}`);
    } else if (type === "state") {
      const data = safeJSON<StatePayload>(raw);
      if (!data) return;

      const device = await db
        .selectFrom("devices")
        .select(["id"])
        .where("mac_address", "=", mac)
        .executeTakeFirst();
      if (!device) return;

      const prev = await db
        .selectFrom("device_state")
        .select([
          "brightness", "light_on", "irrigation_on", "temperature", "water_empty",
          "light_schedule_active", "light_on_seconds", "light_off_seconds", "light_start_at",
          "irrigation_schedule_active", "irrigation_on_seconds", "irrigation_off_seconds", "irrigation_start_at",
        ])
        .where("device_id", "=", device.id)
        .executeTakeFirst();

      // Schedule fields from old firmware are undefined — fall back to the
      // existing device_state values so we don't wipe a backfilled schedule.
      const next = {
        brightness: data.brightness ?? 0,
        light_on: data.lightOn ? 1 : 0,
        irrigation_on: data.irrigationOn ? 1 : 0,
        temperature: data.temperature ?? null,
        water_empty: data.waterEmpty ? 1 : 0,
        light_schedule_active: data.lightScheduleActive === undefined
          ? (prev?.light_schedule_active ?? 0)
          : (data.lightScheduleActive ? 1 : 0),
        light_on_seconds: data.lightScheduleOnSeconds ?? prev?.light_on_seconds ?? 0,
        light_off_seconds: data.lightScheduleOffSeconds ?? prev?.light_off_seconds ?? 0,
        light_start_at: data.lightScheduleStartEpoch ?? prev?.light_start_at ?? 0,
        irrigation_schedule_active: data.irrigationScheduleActive === undefined
          ? (prev?.irrigation_schedule_active ?? 0)
          : (data.irrigationScheduleActive ? 1 : 0),
        irrigation_on_seconds: data.irrigationScheduleOnSeconds ?? prev?.irrigation_on_seconds ?? 0,
        irrigation_off_seconds: data.irrigationScheduleOffSeconds ?? prev?.irrigation_off_seconds ?? 0,
        irrigation_start_at: data.irrigationScheduleStartEpoch ?? prev?.irrigation_start_at ?? 0,
      };

      const changed =
        !prev ||
        prev.brightness !== next.brightness ||
        prev.light_on !== next.light_on ||
        prev.irrigation_on !== next.irrigation_on ||
        prev.temperature !== next.temperature ||
        prev.water_empty !== next.water_empty ||
        prev.light_schedule_active !== next.light_schedule_active ||
        prev.light_on_seconds !== next.light_on_seconds ||
        prev.light_off_seconds !== next.light_off_seconds ||
        prev.light_start_at !== next.light_start_at ||
        prev.irrigation_schedule_active !== next.irrigation_schedule_active ||
        prev.irrigation_on_seconds !== next.irrigation_on_seconds ||
        prev.irrigation_off_seconds !== next.irrigation_off_seconds ||
        prev.irrigation_start_at !== next.irrigation_start_at;

      const now = Date.now();

      await db
        .insertInto("device_state")
        .values({ device_id: device.id, ...next, updated_at: now })
        .onConflict((oc) =>
          oc.column("device_id").doUpdateSet({ ...next, updated_at: now })
        )
        .execute();

      if (changed) {
        await db
          .insertInto("device_state_history")
          .values({ device_id: device.id, ...next, recorded_at: now })
          .execute();
      }

      console.log(`[State] ${mac}: B=${data.brightness} T=${data.temperature}${changed ? "" : " (no change)"}`);
    } else if (type === "log") {
      const data = safeJSON<unknown>(raw);
      const parsed = logSchema.safeParse(data);
      if (!parsed.success) return;

      const device = await db
        .selectFrom("devices")
        .select(["id"])
        .where("mac_address", "=", mac)
        .executeTakeFirst();
      if (!device) return;

      await db
        .insertInto("device_logs")
        .values({
          device_id: device.id,
          level: parsed.data.level,
          tag: parsed.data.tag,
          message: parsed.data.message,
          recorded_at: Date.now(),
        })
        .execute();

      console.log(`[Log] ${mac} ${parsed.data.level}/${parsed.data.tag}: ${parsed.data.message}`);
    } else if (type === "ack") {
      const data = safeJSON<{ type: string }>(raw);
      if (!data?.type) return;
      const key = `${mac}:${data.type}`;
      const pending = pendingAcks.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        pendingAcks.delete(key);
        pending.resolve();
        console.log(`[ACK] ${mac} acknowledged ${data.type}`);
      }
    }
  } catch (err) {
    console.error("MQTT Message Error:", err);
  }
});

mqttClient.on("error", (err) => console.error("MQTT error:", err));
mqttClient.on("reconnect", () => console.log("Reconnecting..."));
mqttClient.on("close", () => console.log("Connection closed"));

process.on("SIGINT", () => {
  console.log("Shutting down gracefully...");
  mqttClient.end();
  process.exit(0);
});
