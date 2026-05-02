import mqtt, { MqttClient } from "mqtt";
import { z } from "zod";
import { db } from "../db";
import { ACK_TIMEOUT_MS } from "../config/schedules";
import { twilio } from "./twilio";

const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER ?? "+14155238886";

// suppress repeat water-empty alerts: device must stay quiet this long before re-alerting
const MIN_DURATION_BETWEEN_ALERTS_MS = 6 * 60 * 60 * 1000;

const MQTT_CONFIG = {
  url: `mqtts://${process.env.MQTT_BROKER_HOST}:8883`,
  options: {
    username: process.env.MQTT_USERNAME!,
    password: process.env.MQTT_PASSWORD!,
  },
  subscriptions: ["ortus/+/presence", "ortus/+/state", "ortus/+/status", "ortus/+/ack"],
};

export const mqttClient: MqttClient = mqtt.connect(
  MQTT_CONFIG.url,
  MQTT_CONFIG.options
);

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

// --- Water alerts ---

async function maybeSendWaterAlert(deviceId: number, mac: string) {
  const now = Date.now();

  // claim the alert slot atomically: only proceed if the previous alert was long enough ago.
  // returning a row from the update means we won the race; an empty result means we skip.
  const claimed = await db
    .updateTable("device_state")
    .set({ last_water_alert_at: now })
    .where("device_id", "=", deviceId)
    .where((eb) =>
      eb.or([
        eb("last_water_alert_at", "is", null),
        eb("last_water_alert_at", "<", now - MIN_DURATION_BETWEEN_ALERTS_MS),
      ])
    )
    .returning("device_id")
    .executeTakeFirst();

  if (!claimed) return;

  const device = await db
    .selectFrom("devices")
    .select("user_id")
    .where("id", "=", deviceId)
    .executeTakeFirst();
  if (!device) return;

  const wa = await db
    .selectFrom("user_whatsapp")
    .select("phone_number")
    .where("user_id", "=", device.user_id)
    .executeTakeFirst();
  if (!wa) return;

  await twilio.messages.create({
    from: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
    to: `whatsapp:${wa.phone_number}`,
    body: "Your Ortus device is running low on water. Please refill soon.",
  });
  console.log(`[Alert] Sent water empty alert for ${mac} to ${wa.phone_number}`);
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
});

type PresencePayload = z.infer<typeof presenceSchema>;
type StatePayload = z.infer<typeof stateSchema>;

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

      await db
        .insertInto("device_state")
        .values({
          device_id: device.id,
          brightness: data.brightness ?? 0,
          light_on: data.lightOn ? 1 : 0,
          irrigation_on: data.irrigationOn ? 1 : 0,
          temperature: data.temperature ?? null,
          water_empty: data.waterEmpty ? 1 : 0,
          updated_at: Date.now(),
        })
        .onConflict((oc) =>
          oc.column("device_id").doUpdateSet({
            brightness: data.brightness ?? 0,
            light_on: data.lightOn ? 1 : 0,
            irrigation_on: data.irrigationOn ? 1 : 0,
            temperature: data.temperature ?? null,
            water_empty: data.waterEmpty ? 1 : 0,
            updated_at: Date.now(),
          })
        )
        .execute();

      if (data.waterEmpty === true) {
        await maybeSendWaterAlert(device.id, mac);
      }

      console.log(`[State] ${mac}: B=${data.brightness} T=${data.temperature}`);
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
