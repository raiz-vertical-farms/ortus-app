// src/index.ts
import mqtt, { MqttClient } from "mqtt";
import { db } from "../db";
import { z } from "zod";

const url = `mqtts://${process.env.MQTT_BROKER_HOST}:8883`;

const options = {
  username: process.env.MQTT_USERNAME!,
  password: process.env.MQTT_PASSWORD!,
};

export const mqttClient: MqttClient = mqtt.connect(url, options);

console.log("Connecting to MQTT broker...");

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");

  const subscriptions: Array<[string, string]> = [
    ["+/presence", "presence"],
    ["+/status", "status"],
    ["+/sensor/#", "sensor"],
  ];

  for (const [pattern, label] of subscriptions) {
    mqttClient.subscribe(pattern, (err) => {
      if (err) {
        console.error(`Subscribe error (${label}):`, err);
      } else {
        console.log(`Subscribed to ${pattern}`);
      }
    });
  }
});

mqttClient.on("message", async (topic, message) => {
  try {
    const parts = topic.split("/");
    const [mac, category] = parts;

    if (!mac || !category) {
      return;
    }

    if (category === "presence") {
      await handlePresence(mac, message);
    } else if (category === "status") {
      await handleStatus(mac, message);
    } else if (category === "sensor") {
      await handleSensorData(mac, parts.slice(2), message);
    }
  } catch (err) {
    console.error("Error processing message:", err);
  }
});

async function handlePresence(mac_address: string, message: Buffer) {
  if (!mac_address) {
    console.warn("Presence topic missing MAC address");
    return;
  }

  const rawMessage = message.toString();

  const presenceSchema = z.object({
    publicIp: z.string().trim().min(1).optional(),
    localIp: z.string().trim().min(1).optional(),
    wsPort: z
      .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
      .optional(),
  });

  const parsed = presenceSchema.safeParse(
    (() => {
      try {
        return JSON.parse(rawMessage);
      } catch (error) {
        return undefined;
      }
    })()
  );

  const update: Record<string, number | string | null> = {
    last_seen: Math.floor(Date.now() / 1000),
    online: 1,
  };

  if (parsed.success) {
    const payload = parsed.data;

    if (payload.localIp) {
      update.lan_ip = payload.localIp;
    }

    if (payload.wsPort !== undefined) {
      const portValue =
        typeof payload.wsPort === "number"
          ? payload.wsPort
          : Number.parseInt(payload.wsPort, 10);
      if (!Number.isNaN(portValue)) {
        update.lan_ws_port = portValue;
      }
    }
  }

  await db
    .updateTable("devices")
    .set(update)
    .where("mac_address", "=", mac_address)
    .execute();

  await db
    .insertInto("device_timeseries")
    .values({
      mac_address: mac_address,
      metric: "presence",
      value_text: parsed.success ? JSON.stringify(parsed.data) : rawMessage,
      value_type: parsed.success ? "json" : "text",
    })
    .execute();

  if (parsed.success) {
    const { publicIp, localIp, wsPort } = parsed.data;
    console.log(
      `Updated presence for ${mac_address} (public IP: ${publicIp ?? "unknown"}, LAN: ${localIp ?? "unknown"}, WS port: ${wsPort ?? "n/a"})`
    );
  } else {
    console.warn(
      `Presence payload for ${mac_address} failed validation, stored as text`
    );
  }
}

async function handleStatus(mac_address: string, message: Buffer) {
  if (!mac_address) {
    console.warn("Status topic missing MAC address");
    return;
  }

  const status = message.toString().trim().toLowerCase();
  const isOnline = status === "online";

  const update: { online: number; last_seen?: number } = {
    online: isOnline ? 1 : 0,
  };

  if (isOnline) {
    update.last_seen = Math.floor(Date.now() / 1000);
  }

  await db
    .updateTable("devices")
    .set(update)
    .where("mac_address", "=", mac_address)
    .execute();

  await db
    .insertInto("device_timeseries")
    .values({
      mac_address,
      metric: "status",
      value_text: status,
      value_type: "text",
    })
    .execute();

  console.log(
    `Updated status for ${mac_address} to ${status}. Online flag: ${isOnline}`
  );
}

async function handleSensorData(mac: string, pathParts: string[], message: Buffer) {
  if (pathParts.length < 2) {
    return;
  }

  const stateSuffix = pathParts[pathParts.length - 1];
  if (stateSuffix !== "state") {
    return;
  }

  const metric = pathParts.slice(0, -1).join("/");
  const valueStr = message.toString();
  const valueType = inferValueType(valueStr);

  await db
    .insertInto("device_timeseries")
    .values({
      mac_address: mac,
      metric: metric,
      value_text: valueStr,
      value_type: valueType,
    })
    .execute();

  console.log(`Recorded ${metric}=${valueStr} for ${mac}`);
}

function inferValueType(value: string): string {
  // Check if numeric
  if (!isNaN(Number(value)) && value.trim() !== "") {
    return Number.isInteger(Number(value)) ? "int" : "float";
  }
  // Check if boolean
  if (value.toLowerCase() === "true" || value.toLowerCase() === "false") {
    return "boolean";
  }
  // Default to string
  return "text";
}

mqttClient.on("error", (err) => console.error("MQTT error:", err));
mqttClient.on("reconnect", () => console.log("Reconnecting..."));
mqttClient.on("close", () => console.log("Connection closed"));

process.on("SIGINT", () => {
  console.log("Shutting down gracefully...");
  mqttClient.end();
  process.exit(0);
});
