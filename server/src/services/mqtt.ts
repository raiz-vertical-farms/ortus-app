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

  mqttClient.subscribe("presence/#", async (err) => {
    if (err) {
      console.error("Subscribe error:", err);
    } else {
      console.log("Subscribed to presence topic");
    }
  });
});

mqttClient.on("message", async (topic, message) => {
  try {
    const parts = topic.split("/");
    const unique_id = parts[1];

    await db
      .updateTable("devices")
      .set({ last_seen: new Date().toISOString() })
      .where("unique_id", "=", unique_id)
      .execute();

    console.log(`Updated last_seen for device ${unique_id}`);
  } catch (err) {
    console.error("DB update error:", err);
  }
});

mqttClient.on("error", (err) => console.error("MQTT error:", err));
mqttClient.on("reconnect", () => console.log("Reconnecting..."));
mqttClient.on("close", () => console.log("Connection closed"));

process.on("SIGINT", () => {
  mqttClient.end();
  process.exit(0);
});
