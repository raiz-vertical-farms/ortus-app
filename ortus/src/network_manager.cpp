#include <WiFi.h>
#include <esp_sntp.h>
#include <time.h>
#include "network_manager.h"
#include "config.h"
#include <Adafruit_NeoPixel.h>

#define RELAY_LEFT_PIN 16
#define RELAY_RIGHT_PIN 17

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
      transports{&websocketAdapter, nullptr},
      transportCount(1),
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
      waitingForTimeSyncLogged(false),
      adaptersInitialized(false),
      hasBroadcastState(false),
      appliedBrightness(-1)
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

  mqttAdapter.setCommandHandler([this](const DeviceCommand &command)
                                { handleDeviceCommand(command); });

  for (size_t i = 0; i < transportCount; ++i)
  {
    transports[i]->setCommandHandler([this](const DeviceCommand &command)
                                     { handleDeviceCommand(command); });
  }

  pixels.begin();
  pinMode(RELAY_LEFT_PIN, OUTPUT);
  pinMode(RELAY_RIGHT_PIN, OUTPUT);
  digitalWrite(RELAY_LEFT_PIN, HIGH); // assuming active LOW relays
  digitalWrite(RELAY_RIGHT_PIN, HIGH);

  broadcastState(true);
}

void NetworkManager::loop()
{
  connectWiFi();

  const wl_status_t wifiStatus = WiFi.status();
  const bool wifiConnected = wifiStatus == WL_CONNECTED;

  if (!wifiConnected)
  {
    if (wifiWasConnected)
    {
      Serial.println(F("[Network] Wi-Fi connection lost"));
    }
    wifiWasConnected = false;
    mqttWasConnected = false;
  }
  else
  {
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
  }

  void NetworkManager::setBrightness(int value)
  {
    if (value < 0 || value > 100)
    {
      Serial.print(F("[Device] Ignoring invalid brightness: "));
      Serial.println(value);
      return;
    }

    const bool changed = deviceState.brightness != value;
    deviceState.brightness = value;

    if (changed)
    {
      stateStore.save(deviceState);
    }

    mqttAdapter.publishBrightnessState(deviceState.brightness);
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

    if (force)
    {
      mqttAdapter.notifyState(deviceState);
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

  void NetworkManager::applyBrightnessToRelays(int value)
  {
    int clamped = constrain(value, 0, 100);

    // Active when brightness > 0
    bool on = clamped > 0;

    const int level = map(clamped, 0, 100, 0, 255);

    if (level == 0)
    {
      pixels.clear();
    }
    else
    {
      pixels.setPixelColor(0, pixels.Color(level, level, level));
    }

    pixels.show();

    // Assuming relay module is active LOW:
    digitalWrite(RELAY_LEFT_PIN, on ? LOW : HIGH);
    digitalWrite(RELAY_RIGHT_PIN, on ? LOW : HIGH);

    Serial.printf("[Relays] %s (brightness %d)\n", on ? "ON" : "OFF", clamped);
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
    waitingForTimeSyncLogged = false;
    scheduleActive = false;
    lastScheduleEvaluation = 0;
    appliedBrightness = -1;
    lastWiFiAttempt = 0;
    macAddress = "";
    adaptersInitialized = false;
    mqttAdapter.setIdentity("");
    WiFi.disconnect(true, true);
    connectWiFi();
  }
