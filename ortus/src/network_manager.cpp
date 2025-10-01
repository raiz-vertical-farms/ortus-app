#include "network_manager.h"

#include "config.h"

NetworkManager *NetworkManager::instance_ = nullptr;

NetworkManager::NetworkManager() : client(espClient), lastPresenceAt(0), lightOn(false)
{
  instance_ = this;
}

void NetworkManager::begin()
{
  connectWiFi();

  espClient.setInsecure();
  client.setServer(MQTT_BROKER_HOST, MQTT_PORT);
  client.setCallback(NetworkManager::mqttCallbackRouter);
}

void NetworkManager::loop()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    connectWiFi();
  }

  if (!client.connected())
  {
    ensureMqttConnection();
  }

  client.loop();

  const unsigned long now = millis();
  if (now - lastPresenceAt >= PRESENCE_INTERVAL_MS)
  {
    lastPresenceAt = now;
    publishPresence();
  }
}

void NetworkManager::mqttCallbackRouter(char *topic, uint8_t *payload, unsigned int length)
{
  if (instance_ != nullptr)
  {
    instance_->handleMqttMessage(topic, payload, length);
  }
}

void NetworkManager::connectWiFi()
{
  if (WiFi.status() == WL_CONNECTED)
  {
    return;
  }

  Serial.print("Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, WIFI_CHANNEL);

  while (WiFi.status() != WL_CONNECTED)
  {
    delay(100);
    Serial.print(".");
  }
  Serial.println(" Connected!");

  Serial.print("Local IP: ");
  Serial.println(WiFi.localIP());

  macAddress = WiFi.macAddress();
}

void NetworkManager::ensureMqttConnection()
{
  while (!client.connected())
  {
    Serial.print("Attempting MQTT connection...");
    String clientId = String("ESP32-") + macAddress;

    if (client.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD))
    {
      Serial.println("connected");
      client.subscribe(getCommandTopic().c_str());
      publishLightState();
    }
    else
    {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void NetworkManager::publishPresence()
{
  const String topic = getPresenceTopic();
  const String payload = getPublicIP();

  if (!client.publish(topic.c_str(), payload.c_str()))
  {
    Serial.println("Failed to publish presence");
  }
  else
  {
    Serial.print("Published to ");
    Serial.print(topic);
    Serial.print(": ");
    Serial.println(payload);
  }
}

void NetworkManager::publishLightState()
{
  const String topic = getStateTopic();
  const char *payload = lightOn ? "on" : "off";

  if (!client.publish(topic.c_str(), payload, true))
  {
    Serial.println("Failed to publish light state");
  }
  else
  {
    Serial.print("Light state published: ");
    Serial.print(topic);
    Serial.print(" -> ");
    Serial.println(payload);
  }
}

void NetworkManager::handleMqttMessage(char *topic, uint8_t *payload, unsigned int length)
{
  const String commandTopic = getCommandTopic();

  if (!commandTopic.equals(topic))
  {
    return;
  }

  String message;
  message.reserve(length);
  for (unsigned int i = 0; i < length; i++)
  {
    message += static_cast<char>(payload[i]);
  }

  message.trim();
  message.toLowerCase();

  processLightCommand(message);
}

void NetworkManager::processLightCommand(const String &command)
{
  if (command == "on")
  {
    lightOn = true;
    publishLightState();
  }
  else if (command == "off")
  {
    lightOn = false;
    publishLightState();
  }
  else
  {
    Serial.print("Unknown light command: ");
    Serial.println(command);
  }
}

String NetworkManager::getPresenceTopic() const
{
  return String("presence/") + macAddress;
}

String NetworkManager::getCommandTopic() const
{
  return macAddress + String("/sensor/light/command");
}

String NetworkManager::getStateTopic() const
{
  return macAddress + String("/sensor/light/state");
}

String NetworkManager::getPublicIP()
{
  WiFiClientSecure https;
  https.setInsecure();

  if (!https.connect("api.ipify.org", 443))
  {
    Serial.println("Connection to ipify failed");
    return "unknown";
  }

  https.println("GET / HTTP/1.1");
  https.println("Host: api.ipify.org");
  https.println("User-Agent: ESP32");
  https.println("Connection: close");
  https.println();

  String line;
  while (https.connected())
  {
    line = https.readStringUntil('\n');
    if (line == "\r")
    {
      break;
    }
  }

  String ip = https.readString();
  ip.trim();
  return ip.length() > 0 ? ip : "unknown";
}
