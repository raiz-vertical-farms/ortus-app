// src/index.ts
import mqtt, { MqttClient } from "mqtt";
import { db } from "../db";

const url = `mqtts://${process.env.MQTT_BROKER_HOST}:8883`;

const options = {
  username: process.env.MQTT_USERNAME!,
  password: process.env.MQTT_PASSWORD!,
};

export const mqttClient: MqttClient = mqtt.connect(url, options);

console.log("Connecting to MQTT broker...");

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");
  mqttClient.subscribe("presence", (err) => {
    if (!err) {
      mqttClient.publish("presence/1", "IP.ADDRESS");
    } else {
      console.error("Subscribe error:", err);
    }
  });
});

mqttClient.subscribe("presence/#", async (err) => {
  if (err) {
    console.error("Subscribe error:", err);
  } else {
    console.log("Subscribed to presence topic");
  }
});

mqttClient.on("message", async (topic, message) => {
  try {
    const parts = topic.split("/"); // ["presence", "123"]
    const deviceId = parts[1]; // "123"

    const deviceIdNumber = Number(deviceId);

    if (isNaN(deviceIdNumber)) {
      console.error("Invalid device ID:", deviceId);
      return;
    }

    await db
      .updateTable("devices")
      .set({ last_seen: new Date().toISOString() })
      .where("id", "=", deviceIdNumber)
      .execute();

    console.log(`Updated last_seen for device ${deviceId}`);
  } catch (err) {
    console.error("DB update error:", err);
  }
});
