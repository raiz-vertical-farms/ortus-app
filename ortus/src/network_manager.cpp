#include <WiFi.h>
#include <esp_sntp.h>
#include <time.h>
#include <math.h>
#include "network_manager.h"
#include "config.h"
#include <OneWire.h>
#include <DallasTemperature.h>

namespace
{
  constexpr int RELAY_PUMP_PIN = 13;
  constexpr int RELAY_FAN_PIN = 14;

  constexpr int WATER_LEVEL_PIN = 10; // Analog water level sensor
  constexpr int TEMP_SENSOR_PIN = 7;  // DS18B20 data line

  constexpr int PWM_PIN = 11;
  constexpr int PWM_CHANNEL = 0;
  constexpr int PWM_FREQ = 20000;
  constexpr int PWM_RES = 8; // 0-255

  constexpr unsigned long TEMPERATURE_POLL_INTERVAL_MS = 5000;
  constexpr unsigned long WATER_LEVEL_POLL_INTERVAL_MS = 2000;
  constexpr unsigned long MAX_PUMP_DURATION_SECONDS = 900; // 15 minutes max

  constexpr int WATER_EMPTY_THRESHOLD = 1500;         // ADC threshold for "empty" – adjust as needed
  constexpr int WATER_HYSTERESIS = 100;
  constexpr float TEMPERATURE_DELTA_THRESHOLD = 0.25; // °C change before publish
  constexpr float FAN_ON_TEMP_C = 32.0f;
  constexpr float FAN_OFF_TEMP_C = 30.0f;
}

OneWire oneWire(TEMP_SENSOR_PIN);
DallasTemperature temperatureSensors(&oneWire);

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
      appliedBrightness(-1),
      pumpStopAt(0),
      lastTempReadAt(0),
      lastWaterReadAt(0),
      lastWaterRaw(-1)
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
    Serial.printf("[Network] Restored brightness state: %d\n", deviceState.brightness);
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

  temperatureSensors.begin();
  temperatureSensors.setResolution(12);

  pinMode(WATER_LEVEL_PIN, INPUT);
  pinMode(RELAY_PUMP_PIN, OUTPUT);
  pinMode(RELAY_FAN_PIN, OUTPUT);
  digitalWrite(RELAY_PUMP_PIN, HIGH); // assuming active LOW relays
  digitalWrite(RELAY_FAN_PIN, HIGH);

  ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RES);
  ledcAttachPin(PWM_PIN, PWM_CHANNEL);

  applyBrightnessToRelays(deviceState.brightness);

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

  updatePump();
  updateSensors();
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
  case CommandType::TriggerPump:
    triggerPump(command.pumpDurationSeconds);
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

  const bool changed = deviceState.brightness != value;
  deviceState.brightness = value;

  if (changed)
  {
    stateStore.save(deviceState);
  }

  applyBrightnessToRelays(deviceState.brightness);
  mqttAdapter.publishBrightnessState(deviceState.brightness);
  broadcastState();
}

void NetworkManager::triggerPump(unsigned long durationSeconds)
{
  if (durationSeconds == 0)
  {
    Serial.println(F("[Pump] Ignoring zero duration command"));
    return;
  }

  if (durationSeconds > MAX_PUMP_DURATION_SECONDS)
  {
    durationSeconds = MAX_PUMP_DURATION_SECONDS;
  }

  const unsigned long now = millis();
  pumpStopAt = now + durationSeconds * 1000UL;

  const bool wasActive = deviceState.pumpActive;
  deviceState.pumpActive = true;

  digitalWrite(RELAY_PUMP_PIN, LOW); // active LOW
  mqttAdapter.publishPumpState(true);
  broadcastState();
  setFan(true, " (pump active)");

  Serial.printf("[Pump] %s for %lu seconds\n", wasActive ? "Extending run" : "Started", durationSeconds);
}

void NetworkManager::stopPump()
{
  if (!deviceState.pumpActive)
  {
    return;
  }

  deviceState.pumpActive = false;
  pumpStopAt = 0;
  digitalWrite(RELAY_PUMP_PIN, HIGH);
  mqttAdapter.publishPumpState(false);
  broadcastState();
  const bool keepFanOn = !isnan(deviceState.temperatureC) && deviceState.temperatureC >= FAN_OFF_TEMP_C;
  setFan(keepFanOn);

  Serial.println(F("[Pump] Stopped"));
}

void NetworkManager::setFan(bool on, const char *reason)
{
  if (deviceState.fanActive == on)
  {
    return;
  }

  deviceState.fanActive = on;
  digitalWrite(RELAY_FAN_PIN, on ? LOW : HIGH); // active LOW
  mqttAdapter.publishFanState(on);
  broadcastState();

  Serial.printf("[Fan] %s%s\n", on ? "ON" : "OFF", reason ? reason : "");
}

void NetworkManager::updatePump()
{
  if (!deviceState.pumpActive)
  {
    return;
  }

  const unsigned long now = millis();
  if (static_cast<long>(now - pumpStopAt) >= 0)
  {
    stopPump();
  }
}

void NetworkManager::updateSensors()
{
  const unsigned long now = millis();

  if (now - lastTempReadAt >= TEMPERATURE_POLL_INTERVAL_MS)
  {
    lastTempReadAt = now;
    temperatureSensors.requestTemperatures();
    const float tempC = temperatureSensors.getTempCByIndex(0);

    const bool valid = tempC > -100.0f && tempC < 125.0f;
    if (valid)
    {
      const bool tempChanged = isnan(deviceState.temperatureC) || fabs(tempC - deviceState.temperatureC) >= TEMPERATURE_DELTA_THRESHOLD;
      if (tempChanged)
      {
        deviceState.temperatureC = tempC;
        mqttAdapter.publishTemperatureState(tempC);
        broadcastState();
      }

      const bool wantsFanFromTemp = deviceState.fanActive ? tempC >= FAN_OFF_TEMP_C : tempC >= FAN_ON_TEMP_C;
      const bool shouldFanBeOn = deviceState.pumpActive || wantsFanFromTemp;
      setFan(shouldFanBeOn, deviceState.pumpActive ? " (pump active)" : "");
    }
    else
    {
      Serial.println(F("[Sensor] Invalid temperature reading"));
    }
  }

  if (now - lastWaterReadAt >= WATER_LEVEL_POLL_INTERVAL_MS)
  {
    lastWaterReadAt = now;
    const int raw = analogRead(WATER_LEVEL_PIN);
    bool empty = deviceState.waterEmpty;

    if (lastWaterRaw < 0)
    {
      empty = raw < WATER_EMPTY_THRESHOLD;
    }
    else
    {
      const int upper = WATER_EMPTY_THRESHOLD + WATER_HYSTERESIS;
      const int lower = WATER_EMPTY_THRESHOLD - WATER_HYSTERESIS;
      if (empty && raw > upper)
      {
        empty = false;
      }
      else if (!empty && raw < lower)
      {
        empty = true;
      }
    }

    lastWaterRaw = raw;

    if (empty != deviceState.waterEmpty)
    {
      deviceState.waterEmpty = empty;
      mqttAdapter.publishWaterEmptyState(empty);
      broadcastState();
      Serial.printf("[Water] %s (raw=%d)\n", empty ? "EMPTY" : "OK", raw);
    }
  }
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

  if (appliedBrightness == clamped)
  {
    return;
  }

  appliedBrightness = clamped;

  const int level = map(clamped, 0, 100, 0, (1 << PWM_RES) - 1);

  ledcWrite(PWM_CHANNEL, level);

  Serial.printf("[LED] PWM level %d (brightness %d)\n", level, clamped);
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
  appliedBrightness = -1;
  lastWiFiAttempt = 0;
  lastWaterRaw = -1;
  macAddress = "";
  adaptersInitialized = false;
  mqttAdapter.setIdentity("");
  WiFi.disconnect(true, true);
  connectWiFi();
}
