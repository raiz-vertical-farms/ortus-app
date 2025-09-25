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

mqttClient.on("message", (topic: string, message: Buffer) => {
  console.log(`Received on ${topic}: ${message.toString()}`);
});

mqttClient.subscribe("presence/1", async (err) => {
  if (err) {
    console.error("Subscribe error:", err);
  } else {
    try {
      await db
        .updateTable("devices")
        .set({
          last_seen: new Date().toISOString(),
        })
        .where("id", "=", 1)
        .execute();

      console.log("Updated last_seen for device 1");
    } catch (dbErr) {
      console.error("DB update error:", dbErr);
    }
  }
});
