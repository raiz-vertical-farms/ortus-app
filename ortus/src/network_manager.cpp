#include <Adafruit_NeoPixel.h>
#include <WiFi.h>
#include "network_manager.h"
#include "config.h"

#define LED_PIN 38
#define NUM_LEDS 1

Adafruit_NeoPixel pixels(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

NetworkManager *NetworkManager::instance_ = nullptr;

NetworkManager::NetworkManager(WiFiCredentialsStore &credentialsStore)
    : credentials(credentialsStore),
      client(espClient),
      stateStore(),
      mqttAdapter(espClient, client),
      websocketAdapter(WS_SERVER_PORT),
      transports{&mqttAdapter, &websocketAdapter},
      transportCount(2),
      macAddress(""),
      lastPresenceAt(0),
      lastWiFiAttempt(0),
      lastPublicIpFetch(0),
      deviceState(),
      lastBroadcastState(),
      wifiWasConnected(false),
      mqttWasConnected(false),
      waitingForCredentialsLogged(false),
      waitingBeforeRetryLogged(false),
      adaptersInitialized(false),
      hasBroadcastState(false)
{
  instance_ = this;
  cachedPublicIp.reserve(32);
}

void NetworkManager::begin()
{
  Serial.println(F("[Network] Initializing network manager"));

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);

  stateStore.begin();
  DeviceState restoredState = deviceState;
  const bool restored = stateStore.load(restoredState);
  if (restored)
  {
    deviceState = restoredState;
    Serial.printf("[Network] Restored brightness %d (schedule %s)\n", deviceState.brightness, deviceState.hasSchedule ? "enabled" : "disabled");
  }
  else
  {
    stateStore.save(deviceState);
  }

  connectWiFi();

  mqttAdapter.setCredentials(MQTT_BROKER_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD);
  mqttAdapter.begin();
  websocketAdapter.begin();

  for (size_t i = 0; i < transportCount; ++i)
  {
    transports[i]->setCommandHandler([this](const DeviceCommand &command) {
      handleDeviceCommand(command);
    });
  }

  pixels.begin();
  applyBrightnessToPixels();
  broadcastState(true);
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
    onWiFiConnected();
  }

  ensureAdapterIdentity();

  mqttAdapter.loop();
  const bool mqttConnected = mqttAdapter.isConnected();
  if (mqttConnected && !mqttWasConnected)
  {
    broadcastState(true);
  }
  mqttWasConnected = mqttConnected;

  websocketAdapter.loop();

  const unsigned long now = millis();
  if (now - lastPresenceAt >= PRESENCE_INTERVAL_MS)
  {
    lastPresenceAt = now;
    publishPresence();
  }
}

void NetworkManager::onWiFiConnected()
{
  wifiWasConnected = true;
  macAddress = WiFi.macAddress();

  Serial.println(F("[Network] Wi-Fi connected"));
  Serial.print(F("[Network] Local IP: "));
  Serial.println(WiFi.localIP());
  Serial.printf("[Network] Signal strength: %d dBm\n", WiFi.RSSI());

  adaptersInitialized = false;
  lastPresenceAt = 0;
  publishPresence();
}

void NetworkManager::handleDeviceCommand(const DeviceCommand &command)
{
  switch (command.type)
  {
  case CommandType::SetBrightness:
    setBrightness(command.brightness);
    break;
  case CommandType::ScheduleLights:
    updateSchedule(command.schedule);
    break;
  }
}

void NetworkManager::setBrightness(int value)
{
  if (value < 0 || value > 100)
  {
    Serial.print(F("[Device] Ignoring invalid brightness: "));
    Serial.println(value);
    return;
  }

  if (deviceState.brightness == value)
  {
    broadcastState();
    return;
  }

  deviceState.brightness = value;
  applyBrightnessToPixels();
  stateStore.save(deviceState);
  broadcastState();
}

void NetworkManager::updateSchedule(const LightSchedule &schedule)
{
  if (deviceState.hasSchedule == schedule.enabled && deviceState.schedule == schedule)
  {
    broadcastState();
    return;
  }

  deviceState.hasSchedule = schedule.enabled;
  deviceState.schedule = schedule;
  stateStore.save(deviceState);
  broadcastState();
}

void NetworkManager::broadcastState(bool force)
{
  if (!force && hasBroadcastState && deviceState == lastBroadcastState)
  {
    return;
  }

  for (size_t i = 0; i < transportCount; ++i)
  {
    transports[i]->notifyState(deviceState);
  }

  lastBroadcastState = deviceState;
  hasBroadcastState = true;
}

void NetworkManager::publishPresence()
{
  if (!mqttAdapter.isConnected())
  {
    Serial.println(F("[Network] Presence skipped (MQTT not connected)"));
    return;
  }

  cachedPublicIp = getPublicIP();
  const String payload = buildPresencePayload();
  mqttAdapter.publishPresence(payload);
}

String NetworkManager::buildPresencePayload() const
{
  String payload = "{";
  payload += "\"publicIp\":\"";
  payload += cachedPublicIp.length() ? cachedPublicIp : String("unknown");
  payload += "\",\"localIp\":\"";
  payload += WiFi.localIP().toString();
  payload += "\",\"wsPort\":";
  payload += String(websocketAdapter.port());
  payload += "}";
  return payload;
}

void NetworkManager::ensureAdapterIdentity()
{
  if (adaptersInitialized || macAddress.isEmpty())
  {
    return;
  }

  mqttAdapter.setIdentity(macAddress);
  adaptersInitialized = true;
  broadcastState(true);
}

String NetworkManager::getPublicIP()
{
  const unsigned long now = millis();
  if (!cachedPublicIp.isEmpty() && now - lastPublicIpFetch < PUBLIC_IP_REFRESH_MS)
  {
    return cachedPublicIp;
  }

  WiFiClientSecure https;
  https.setInsecure();

  if (!https.connect("api.ipify.org", 443))
  {
    Serial.println(F("[Network] Connection to ipify failed"));
    return cachedPublicIp.length() ? cachedPublicIp : String("unknown");
  }

  https.println("GET /?format=text HTTP/1.1");
  https.println("Host: api.ipify.org");
  https.println("User-Agent: ESP32");
  https.println("Connection: close");
  https.println();

  while (https.connected())
  {
    String line = https.readStringUntil('\n');
    if (line == "\r")
    {
      break;
    }
  }

  String ip = https.readString();
  ip.trim();

  if (ip.length() > 0)
  {
    cachedPublicIp = ip;
    lastPublicIpFetch = now;
  }

  return cachedPublicIp.length() ? cachedPublicIp : String("unknown");
}

void NetworkManager::applyBrightnessToPixels()
{
  const int level = map(deviceState.brightness, 0, 100, 0, 255);

  if (level == 0)
  {
    pixels.clear();
  }
  else
  {
    pixels.setPixelColor(0, pixels.Color(level, level, level));
  }

  pixels.show();
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
      Serial.println(F("[Network] Waiting for Wi-Fi credentials..."));
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

  Serial.print(F("[Network] Connecting to "));
  Serial.println(ssid);

  WiFi.begin(ssid.c_str(), password.c_str());
}

void NetworkManager::forceReconnect()
{
  Serial.println(F("[Network] Forcing Wi-Fi reconnect"));
  wifiWasConnected = false;
  mqttWasConnected = false;
  waitingForCredentialsLogged = false;
  waitingBeforeRetryLogged = false;
  lastWiFiAttempt = 0;
  macAddress = "";
  adaptersInitialized = false;
  mqttAdapter.setIdentity("");
  WiFi.disconnect(true, true);
  connectWiFi();
}
