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

  // Subscribe to presence updates
  mqttClient.subscribe("+/presence", (err) => {
    if (err) {
      console.error("Subscribe error (presence):", err);
    } else {
      console.log("Subscribed to +/presence");
    }
  });

  mqttClient.subscribe("+/status", (err) => {
    if (err) {
      console.error("Subscribe error (status):", err);
    } else {
      console.log("Subscribed to +/status");
    }
  });

  // Subscribe to sensor data (adjust pattern based on your ESPHome config)
  mqttClient.subscribe("+/sensor/+/state", (err) => {
    if (err) {
      console.error("Subscribe error (sensor):", err);
    } else {
      console.log("Subscribed to +/sensor/+/state");
    }
  });

  mqttClient.subscribe("+/sensor/+/schedule/state", (err) => {
    if (err) console.error("Subscribe error (schedule):", err);
    else console.log("Subscribed to +/sensor/+/schedule/state");
  });
});

mqttClient.on("message", async (topic, message) => {
  try {
    const parts = topic.split("/");

    // Handle presence updates
    if (parts.length >= 2 && parts[1] === "presence") {
      await handlePresence(parts[0], message);
    }
    // Handle status updates
    else if (parts.length >= 2 && parts[1] === "status") {
      await handleStatus(parts[0], message);
    }
    // Handle sensor timeseries data
    else if (topic.includes("/sensor/")) {
      await handleSensorData(topic, message);
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

async function handleSensorData(topic: string, message: Buffer) {
  // Topic format: <device_name>/sensor/<metric_name>/state
  // or: <mac_address>/sensor/<metric_name>/state
  const parts = topic.split("/");
  const deviceIdentifier = parts[0]; // Could be device name or MAC
  const metricParts = parts.slice(2, parts.length - 1); // everything between "sensor" and "state"
  const metric = metricParts.join("/"); // "light" or "light/schedule"
  const valueStr = message.toString();

  // Determine value type
  const valueType = determineValueType(valueStr);

  console.log({ valueStr, valueType });

  // Get MAC address from device name if needed
  const macAddress = await getMacAddress(deviceIdentifier);

  if (!macAddress) {
    console.warn(`Could not find MAC address for device: ${deviceIdentifier}`);
    return;
  }

  console.log(`Received MQTT message for ${macAddress}: ${metric}=${valueStr}`);

  // Insert timeseries data
  await db
    .insertInto("device_timeseries")
    .values({
      mac_address: macAddress,
      metric: metric,
      value_text: valueStr,
      value_type: valueType,
    })
    .execute();

  console.log(`Recorded ${metric}=${valueStr} for ${macAddress}`);
}

function determineValueType(value: string): string {
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

async function getMacAddress(deviceIdentifier: string): Promise<string | null> {
  // WIP: For now just return the device identifier
  return deviceIdentifier;

  // If it already looks like a MAC address, return it
  if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(deviceIdentifier)) {
    return deviceIdentifier;
  }

  // Otherwise, look up by device name
  const device = await db
    .selectFrom("devices")
    .select("mac_address")
    .where("name", "=", deviceIdentifier)
    .executeTakeFirst();

  return device?.mac_address || null;
}

mqttClient.on("error", (err) => console.error("MQTT error:", err));
mqttClient.on("reconnect", () => console.log("Reconnecting..."));
mqttClient.on("close", () => console.log("Connection closed"));

process.on("SIGINT", () => {
  console.log("Shutting down gracefully...");
  mqttClient.end();
  process.exit(0);
});
