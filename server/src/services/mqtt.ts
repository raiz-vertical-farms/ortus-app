import mqtt, { MqttClient } from "mqtt";
import { z } from "zod";
import { db } from "../db";

const MQTT_CONFIG = {
  url: `mqtts://${process.env.MQTT_BROKER_HOST}:8883`,
  options: {
    username: process.env.MQTT_USERNAME!,
    password: process.env.MQTT_PASSWORD!,
  },
  // Unified Subscription
  subscriptions: ["ortus/+/presence", "ortus/+/state"],
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

function safeJSON<T>(str: string): T | undefined {
  try {
    return JSON.parse(str) as T;
  } catch {
    return undefined;
  }
}

// Schemas
const presenceSchema = z.object({
  ip: z.string().optional(),
  mac: z.string(),
  uptime: z.number().optional(),
});

const stateSchema = z.object({
  brightness: z.number().optional(),
  irrigationActive: z.boolean().optional(),
  fanActive: z.boolean().optional(),
  temperature: z.number().nullable().optional(),
  waterEmpty: z.boolean().optional(),
});

type PresencePayload = z.infer<typeof presenceSchema>;
type StatePayload = z.infer<typeof stateSchema>;

mqttClient.on("message", async (topic, payload) => {
  try {
    const raw = payload.toString();
    const parts = topic.split("/");
    // Expected topic: ortus/{mac}/{type}
    if (parts.length !== 3 || parts[0] !== "ortus") return;

    const mac = parts[1];
    const type = parts[2];

    if (type === "presence") {
      const data = safeJSON<PresencePayload>(raw);
      if (!data) return;
      
      await db.updateTable("devices")
        .set({
          online: 1,
          last_seen: Math.floor(Date.now() / 1000),
          lan_ip: data.ip
        })
        .where("mac_address", "=", mac)
        .execute();
        
      console.log(`[Presence] ${mac} is online at ${data.ip}`);
    } 
    else if (type === "state") {
      const data = safeJSON<StatePayload>(raw);
      if (!data) return;

      // Update Timeseries & Notifications
      const inserts = [];

      if (data.brightness !== undefined) {
        inserts.push({ mac_address: mac, metric: "light/brightness", value_text: String(data.brightness), value_type: "int" });
      }
      if (data.temperature !== undefined && data.temperature !== null) {
        inserts.push({ mac_address: mac, metric: "temperature", value_text: String(data.temperature), value_type: "float" });
      }
      if (data.waterEmpty !== undefined) {
        inserts.push({ mac_address: mac, metric: "water/empty", value_text: String(data.waterEmpty), value_type: "boolean" });
      }
      if (data.irrigationActive !== undefined) {
        inserts.push({ mac_address: mac, metric: "irrigation/active", value_text: String(data.irrigationActive), value_type: "boolean" });
      }
      // Fan is now part of irrigation, but if we still receive it (or for legacy), we can log it or ignore it.
      // Since we are removing fan logic from firmware, we probably won't receive it.
      
      if (inserts.length > 0) {
        // @ts-ignore - complex insert type matching
        await db.insertInto("device_timeseries").values(inserts).execute();
      }
      
      console.log(`[State] ${mac}: B=${data.brightness} T=${data.temperature}`);
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
