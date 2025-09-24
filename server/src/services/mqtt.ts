// src/index.ts
import mqtt, { MqttClient } from "mqtt";

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
      mqttClient.publish("presence", "Hello mqtt");
    } else {
      console.error("Subscribe error:", err);
    }
  });
});

mqttClient.on("message", (topic: string, message: Buffer) => {
  console.log(`Received on ${topic}: ${message.toString()}`);
});
