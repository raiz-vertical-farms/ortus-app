// src/index.ts
import mqtt, { MqttClient } from "mqtt";

const client: MqttClient = mqtt.connect("mqtt://test.mosquitto.org");

client.on("connect", () => {
  client.subscribe("presence", (err) => {
    if (!err) {
      client.publish("presence", "Hello mqtt");
    } else {
      console.error("Subscribe error:", err);
    }
  });
});

client.on("message", (topic: string, message: Buffer) => {
  console.log(`Received on ${topic}: ${message.toString()}`);
  client.end();
});
