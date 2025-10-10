import mqtt, { MqttClient } from "mqtt";
import { z } from "zod";
import { db } from "../db";

const MQTT_CONFIG = {
  url: `mqtts://${process.env.MQTT_BROKER_HOST}:8883`,
  options: {
    username: process.env.MQTT_USERNAME!,
    password: process.env.MQTT_PASSWORD!,
  },
  subscriptions: ["+/presence", "+/status", "+/sensor/#"],
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

function inferValueType(value: string): "int" | "float" | "boolean" | "text" {
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "false") return "boolean";
  const num = Number(value);
  if (!isNaN(num)) return Number.isInteger(num) ? "int" : "float";
  return "text";
}

const presenceSchema = z.object({
  publicIp: z.string().trim().optional(),
  localIp: z.string().trim().optional(),
  wsPort: z.preprocess(
    (v) => (typeof v === "string" ? parseInt(v, 10) : v),
    z.number().int().nonnegative().optional()
  ),
});

type PresencePayload = z.infer<typeof presenceSchema>;

type Handler = (mac: string, path: string[], payload: Buffer) => Promise<void>;
type Handlers = Record<string, Handler>;

const handlers: Handlers = {
  async presence(mac, _path, payload) {
    const raw = payload.toString();
    const parsed = presenceSchema.safeParse(safeJSON<PresencePayload>(raw));

    const update: Record<string, string | number | null> = {
      last_seen: Math.floor(Date.now() / 1000),
      online: 1,
    };

    if (parsed.success) {
      const { localIp, wsPort } = parsed.data;
      if (localIp) update.lan_ip = localIp;
      if (wsPort !== undefined) update.lan_ws_port = wsPort;
    }

    await db
      .updateTable("devices")
      .set(update)
      .where("mac_address", "=", mac)
      .execute();

    await db
      .insertInto("device_timeseries")
      .values({
        mac_address: mac,
        metric: "presence",
        value_text: parsed.success ? JSON.stringify(parsed.data) : raw,
        value_type: parsed.success ? "json" : "text",
      })
      .execute();

    console.log(
      `Presence ${mac}: IP=${parsed.data?.localIp ?? "?"}, WS=${parsed.data?.wsPort ?? "?"}`
    );
  },

  async status(mac, _path, payload) {
    const status = payload.toString().trim().toLowerCase();
    const isOnline = status === "online";

    await db
      .updateTable("devices")
      .set({
        online: isOnline ? 1 : 0,
        last_seen: Math.floor(Date.now() / 1000),
      })
      .where("mac_address", "=", mac)
      .execute();

    await db
      .insertInto("device_timeseries")
      .values({
        mac_address: mac,
        metric: "status",
        value_text: status,
        value_type: "text",
      })
      .execute();

    console.log(`Status ${mac}: ${status}`);
  },

  async sensor(mac, path, payload) {
    if (path.at(-1) !== "state") return;

    const metric = path.slice(0, -1).join("/");
    const valueStr = payload.toString();
    const valueType = inferValueType(valueStr);

    await db
      .insertInto("device_timeseries")
      .values({
        mac_address: mac,
        metric,
        value_text: valueStr,
        value_type: valueType,
      })
      .execute();

    console.log(`Sensor ${mac}: ${metric}=${valueStr}`);
  },
};

mqttClient.on("message", async (topic, payload) => {
  const [mac, category, ...path] = topic.split("/");
  if (!mac || !category) return;

  const handler = handlers[category];
  if (!handler) return;

  try {
    await handler(mac, path, payload);
  } catch (err) {
    console.error(`Error handling ${category} for ${mac}:`, err);
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
