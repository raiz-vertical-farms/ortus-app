#include <Adafruit_NeoPixel.h>
#include "network_manager.h"
#include "config.h"

#define LED_PIN 38
#define NUM_LEDS 1

Adafruit_NeoPixel pixels(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

NetworkManager *NetworkManager::instance_ = nullptr;

NetworkManager::NetworkManager(WiFiCredentialsStore &credentialsStore)
    : credentials(credentialsStore),
      client(espClient),
      macAddress(""),
      lastPresenceAt(0),
      lastWiFiAttempt(0),
      brightness(0),
      wifiWasConnected(false),
      waitingForCredentialsLogged(false),
      waitingBeforeRetryLogged(false)
{
  instance_ = this;
}

void NetworkManager::begin()
{
  Serial.println(F("[Network] Initializing network manager"));

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);

  connectWiFi();

  espClient.setInsecure();
  client.setServer(MQTT_BROKER_HOST, MQTT_PORT);
  client.setCallback(NetworkManager::mqttCallbackRouter);

  pixels.begin();
}

void NetworkManager::loop()
{
  connectWiFi();

  if (WiFi.status() != WL_CONNECTED)
  {
    wifiWasConnected = false;
    return;
  }

  if (!wifiWasConnected)
  {
    wifiWasConnected = true;
    macAddress = WiFi.macAddress();

    Serial.println("[Network] Wi-Fi connected");
    Serial.print("[Network] Local IP: ");
    Serial.println(WiFi.localIP());
    Serial.printf("[Network] Signal strength: %d dBm\n", WiFi.RSSI());
  }

  if (!client.connected())
  {
    ensureMqttConnection();
    Serial.println(F("[Network] Ensuring MQTT connection"));
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

  if (!credentials.hasCredentials())
  {
    if (!waitingForCredentialsLogged)
    {
      Serial.println("[Network] Waiting for Wi-Fi credentials...");
      waitingForCredentialsLogged = true;
    }
    return;
  }

  waitingForCredentialsLogged = false;

  const unsigned long now = millis();
  if (now - lastWiFiAttempt < 5000)
  {
    if (!waitingBeforeRetryLogged)
    {
      Serial.println(F("[Network] Waiting before next Wi-Fi attempt"));
      waitingBeforeRetryLogged = true;
    }
    return;
  }

  lastWiFiAttempt = now;
  waitingBeforeRetryLogged = false;

  const String ssid = credentials.getSsid();
  const String password = credentials.getPassword();

  Serial.print("[Network] Connecting to ");
  Serial.println(ssid);

  Serial.print("[Network] Password: ");
  Serial.println(password);

  WiFi.begin(ssid.c_str(), password.c_str());
}

void NetworkManager::forceReconnect()
{
  Serial.println(F("[Network] Forcing Wi-Fi reconnect"));
  wifiWasConnected = false;
  waitingForCredentialsLogged = false;
  lastWiFiAttempt = 0;
  waitingBeforeRetryLogged = false;
  WiFi.disconnect(true, true);
  connectWiFi();
}

void NetworkManager::ensureMqttConnection()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    return;
  }

  while (!client.connected())
  {
    Serial.print("Attempting MQTT connection...");
    String clientId = String("ESP32-") + macAddress;

    if (client.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD))
    {
      Serial.println("connected");
      client.subscribe(getCommandTopic().c_str());
      publishLightState();
      Serial.println(F("[Network] MQTT subscription established"));
    }
    else
    {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
      if (WiFi.status() != WL_CONNECTED)
      {
        return;
      }
    }
  }
}

void NetworkManager::publishPresence()
{
  if (!client.connected())
  {
    Serial.println(F("[Network] Presence skipped (MQTT not connected)"));
    return;
  }

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
    Serial.println(F("[Network] Presence heartbeat sent"));
  }
}

void NetworkManager::publishLightState()
{
  const String topic = getStateTopic();
  String payload = String(brightness); // publish brightness as string

  if (!client.publish(topic.c_str(), payload.c_str(), true))
  {
    Serial.println("Failed to publish light state");
  }
  else
  {
    Serial.print("Light brightness published: ");
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
  // Try to parse brightness value (0-100)
  int value = command.toInt();

  if (value >= 0 && value <= 100)
  {
    brightness = value;

    // Scale brightness to 0–255
    int level = map(brightness, 0, 100, 0, 255);

    if (level == 0)
    {
      pixels.clear();
    }
    else
    {
      pixels.setPixelColor(0, pixels.Color(level, level, level)); // white with brightness
    }

    pixels.show();
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
