#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define WIFI_CHANNEL 6

// MQTT broker details
const char* MQTT_BROKER_HOST = "9876023c4d284b20b60c66d5141514c2.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883; // TLS port
const char* MQTT_USERNAME = "ortus";
const char* MQTT_PASSWORD = "replace_with_your_password";

// WiFi and MQTT clients
WiFiClientSecure espClient;
PubSubClient client(espClient);

String macAddress;
unsigned long lastMsg = 0;

// Fetch public IP
String getPublicIP() {
  WiFiClientSecure https;
  https.setInsecure(); // no certificate validation for simplicity

  if (!https.connect("api.ipify.org", 443)) {
    Serial.println("Connection to ipify failed");
    return "unknown";
  }

  https.println("GET / HTTP/1.1");
  https.println("Host: api.ipify.org");
  https.println("User-Agent: ESP32");
  https.println("Connection: close");
  https.println();

  String line;
  while (https.connected()) {
    line = https.readStringUntil('\n');
    if (line == "\r") break; // end of headers
  }

  String ip = https.readString();
  ip.trim();
  return ip.length() > 0 ? ip : "unknown";
}

void setup_wifi() {
  Serial.print("Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, WIFI_CHANNEL);
  while (WiFi.status() != WL_CONNECTED) {
    delay(100);
    Serial.print(".");
  }
  Serial.println(" Connected!");

  Serial.print("Local IP: ");
  Serial.println(WiFi.localIP());

  macAddress = WiFi.macAddress();
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("ESP32Client", MQTT_USERNAME, MQTT_PASSWORD)) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  setup_wifi();

  espClient.setInsecure(); // insecure TLS
  client.setServer(MQTT_BROKER_HOST, MQTT_PORT);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  unsigned long now = millis();
  if (now - lastMsg > 10000) { // every 10s
    lastMsg = now;

    String topic = "presence/" + macAddress;
    String payload = getPublicIP();
    client.publish(topic.c_str(), payload.c_str());

    Serial.print("Published to ");
    Serial.print(topic);
    Serial.print(": ");
    Serial.println(payload);
  }
}
