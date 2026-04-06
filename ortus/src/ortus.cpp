#include "ortus.h"
#include <ArduinoJson.h>
#include "driver/ledc.h"

OrtusSystem *OrtusSystem::instance = nullptr;

OrtusSystem::OrtusSystem()
    : mqttClient(wifiClient),
      wsServer(WS_SERVER_PORT),
      oneWire(PIN_SENSOR_TEMP),
      sensors(&oneWire)
{
    instance = this;
}

void OrtusSystem::begin()
{
    Serial.begin(115200);
    unsigned long start = millis();
    while (!Serial && millis() - start < 2000)
        delay(10);

    Serial.println("\n[System] Ortus Starting...");

    // Hardware Setup
    pinMode(PIN_RELAY_IRRIGATION, OUTPUT);
    pinMode(PIN_RELAY_FAN, OUTPUT);
    pinMode(PIN_SENSOR_WATER, INPUT_PULLUP);

    digitalWrite(PIN_RELAY_IRRIGATION, LOW);
    digitalWrite(PIN_RELAY_FAN, LOW);

    // Setup LEDC PWM for light dimming
    ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_8_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = 25000,
        .clk_cfg = LEDC_AUTO_CLK};
    ledc_timer_config(&timer);

    ledc_channel_config_t channel = {
        .gpio_num = PIN_RELAY_LIGHT,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .timer_sel = LEDC_TIMER_0,
        .duty = 0,
        .hpoint = 0};
    ledc_channel_config(&channel);

    sensors.begin();
    sensors.setResolution(12);
    sensors.setWaitForConversion(false); // Non-blocking

    preferences.begin("ortus", false);
    loadCredentials();
    loadState();

    appliedBrightness = -1;
    updateActuators();

    setupWiFi();
    setupMQTT();

    wsServer.begin();
    wsServer.onEvent(webSocketEvent);

    ble.begin(
        [this](String s, String p) { saveCredentials(s, p); },
        [this]()
        {
            Serial.println("[System] Credentials updated via BLE. Reconnecting...");
            WiFi.disconnect(true);
            lastWifiAttempt = 0;
        });

    Serial.println("[System] Boot complete.");

    if (WiFi.status() != WL_CONNECTED)
        ble.updateWiFiState(false);
}

void OrtusSystem::loop()
{
    ble.loop();
    wsServer.loop();

    connectWiFi();

    if (wifiConnected)
    {
        syncSystemTime();
        connectMQTT();
        mqttClient.loop();

        if (millis() - lastPresence > PRESENCE_INTERVAL_MS)
        {
            publishPresence();
            lastPresence = millis();
        }
    }

    updateSensors();
    updateActuators();
}

// --- WiFi ---

void OrtusSystem::setupWiFi()
{
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    macAddress = WiFi.macAddress();
}

void OrtusSystem::connectWiFi()
{
    wl_status_t status = WiFi.status();

    if (status == WL_CONNECTED)
    {
        if (!wifiConnected)
        {
            wifiConnected = true;
            Serial.println("[WiFi] Connected! IP: " + WiFi.localIP().toString());
            Serial.println("[WiFi] RSSI: " + String(WiFi.RSSI()) + " dBm");
            configTime(0, 0, "pool.ntp.org", "time.google.com");
            ble.updateWiFiState(true);
            publishPresence();
        }
        return;
    }

    if (wifiConnected)
    {
        wifiConnected = false;
        timeSynced = false;
        ble.updateWiFiState(false);
    }

    if (wifiSSID.isEmpty())
        return;

    // Only call WiFi.begin() on definitive failure or first attempt.
    // Calling it while a connection is in progress resets the attempt.
    bool shouldRetry = false;

    if (status == WL_NO_SSID_AVAIL || status == WL_CONNECT_FAILED || status == WL_CONNECTION_LOST)
        shouldRetry = true;
    else if (status == WL_DISCONNECTED && millis() - lastWifiAttempt > 30000)
        shouldRetry = true; // stuck in disconnected state too long
    else if (lastWifiAttempt == 0)
        shouldRetry = true; // first attempt

    if (shouldRetry)
    {
        lastWifiAttempt = millis();
        Serial.print("[WiFi] Connecting to '");
        Serial.print(wifiSSID);
        Serial.print("' (status=");
        Serial.print(status);
        Serial.println(")");
        // Status codes: 0=IDLE, 1=NO_SSID_AVAIL, 2=SCAN_COMPLETED,
        //   3=CONNECTED, 4=CONNECT_FAILED, 5=CONNECTION_LOST, 6=DISCONNECTED
        WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
    }
}

// --- Time Sync ---

void OrtusSystem::syncSystemTime()
{
    if (timeSynced)
        return;

    time_t now;
    time(&now);
    if (now > 1700000000)
    {
        timeSynced = true;
        Serial.println("[Time] System time synchronized");
        recoverSchedules();
    }
}

void OrtusSystem::recoverSchedules()
{
    if (!timeSynced)
        return;

    time_t now;
    time(&now);
    unsigned long currentEpoch = (unsigned long)now;

    // Light Cycle Recovery
    if (currentState.lightCycleActive && currentState.lightCycleStartEpoch > 0)
    {
        unsigned long totalCycle = currentState.lightCycleOnSeconds + currentState.lightCycleOffSeconds;
        if (totalCycle > 0)
        {
            unsigned long elapsed = currentEpoch - currentState.lightCycleStartEpoch;
            unsigned long position = elapsed % totalCycle;

            if (position < currentState.lightCycleOnSeconds)
            {
                lightCycleIsOnPhase = true;
                lightCycleStartMillis = millis() - (position * 1000);
            }
            else
            {
                lightCycleIsOnPhase = false;
                lightCycleStartMillis = millis() - ((position - currentState.lightCycleOnSeconds) * 1000);
            }
            currentState.brightness = lightCycleIsOnPhase ? 100 : 0;
            appliedBrightness = -1;
            Serial.println("[Schedule] Light cycle recovered");
        }
    }

    // Irrigation Cycle Recovery
    if (currentState.irrigationCycleActive && currentState.irrigationCycleStartEpoch > 0)
    {
        unsigned long totalCycle = currentState.irrigationCycleOnSeconds + currentState.irrigationCycleOffSeconds;
        if (totalCycle > 0)
        {
            unsigned long elapsed = currentEpoch - currentState.irrigationCycleStartEpoch;
            unsigned long position = elapsed % totalCycle;

            if (position < currentState.irrigationCycleOnSeconds)
            {
                irrigationCycleIsOnPhase = true;
                irrigationCycleStartMillis = millis() - (position * 1000);
            }
            else
            {
                irrigationCycleIsOnPhase = false;
                irrigationCycleStartMillis = millis() - ((position - currentState.irrigationCycleOnSeconds) * 1000);
            }
            currentState.irrigationActive = irrigationCycleIsOnPhase;
            Serial.println("[Schedule] Irrigation cycle recovered");
        }
    }

    // Fan Cycle Recovery
    if (currentState.fanCycleActive && currentState.fanCycleStartEpoch > 0)
    {
        unsigned long totalCycle = currentState.fanCycleOnSeconds + currentState.fanCycleOffSeconds;
        if (totalCycle > 0)
        {
            unsigned long elapsed = currentEpoch - currentState.fanCycleStartEpoch;
            unsigned long position = elapsed % totalCycle;

            if (position < currentState.fanCycleOnSeconds)
            {
                fanCycleIsOnPhase = true;
                fanCycleStartMillis = millis() - (position * 1000);
            }
            else
            {
                fanCycleIsOnPhase = false;
                fanCycleStartMillis = millis() - ((position - currentState.fanCycleOnSeconds) * 1000);
            }
            currentState.fanActive = fanCycleIsOnPhase;
            Serial.println("[Schedule] Fan cycle recovered");
        }
    }

    broadcastState(true);
}

// --- MQTT ---

void OrtusSystem::setupMQTT()
{
    wifiClient.setInsecure();
    mqttClient.setServer(MQTT_BROKER_HOST, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setBufferSize(1024);
}

void OrtusSystem::connectMQTT()
{
    if (mqttClient.connected())
        return;

    static unsigned long lastMqttAttempt = 0;
    if (millis() - lastMqttAttempt < 5000)
        return;
    lastMqttAttempt = millis();

    Serial.print("[MQTT] Connecting...");
    String clientId = "Ortus-" + macAddress;
    String lwtTopic = "ortus/" + macAddress + "/status";

    if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD, lwtTopic.c_str(), 1, true, "offline"))
    {
        Serial.println("Connected");
        mqttClient.publish(lwtTopic.c_str(), "online", true);
        String cmdTopic = "ortus/" + macAddress + "/command";
        mqttClient.subscribe(cmdTopic.c_str());
        broadcastState(true);
    }
    else
    {
        Serial.print("Failed, rc=");
        Serial.println(mqttClient.state());
    }
}

void OrtusSystem::mqttCallback(char *topic, uint8_t *payload, unsigned int length)
{
    if (instance)
        instance->onMqttMessage(topic, payload, length);
}

void OrtusSystem::onMqttMessage(char *topic, uint8_t *payload, unsigned int length)
{
    processRawCommand(payload, length);
}

// --- WebSocket ---

void OrtusSystem::webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length)
{
    if (instance)
        instance->onWebSocketMessage(num, type, payload, length);
}

void OrtusSystem::onWebSocketMessage(uint8_t num, WStype_t type, uint8_t *payload, size_t length)
{
    if (type == WStype_TEXT)
        processRawCommand(payload, length);
    else if (type == WStype_CONNECTED)
        broadcastState(true);
}

// --- Command parsing ---

void OrtusSystem::processRawCommand(const uint8_t *payload, size_t length)
{
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);
    if (error)
    {
        Serial.println("[Command] JSON Error");
        return;
    }

    DeviceCommand cmd;
    String type = doc["type"] | "";

    if (type == "setBrightness")
    {
        cmd.type = CommandType::SetBrightness;
        if (doc["value"].isNull())
            return;
        cmd.brightness = doc["value"];
    }
    else if (type == "setLightSchedule" || type == "setIrrigationSchedule" || type == "setFanSchedule")
    {
        if (type == "setLightSchedule")
            cmd.type = CommandType::SetLightSchedule;
        else if (type == "setIrrigationSchedule")
            cmd.type = CommandType::SetIrrigationSchedule;
        else
            cmd.type = CommandType::SetFanSchedule;

        cmd.scheduleActive = doc["active"] | false;
        cmd.cycleOnSeconds = (unsigned long)(doc["minutes_on"] | 0) * 60;
        cmd.cycleOffSeconds = (unsigned long)(doc["minutes_off"] | 0) * 60;
        cmd.startOff = doc["start_off"] | false;

        if (doc.containsKey("start_at"))
        {
            cmd.start_at_epoch = doc["start_at"];
        }
        else if (timeSynced)
        {
            time_t now;
            time(&now);
            cmd.start_at_epoch = (unsigned long)now;
        }
        else
        {
            cmd.start_at_epoch = 0;
        }
    }
    else if (type == "otaUpdate")
    {
        cmd.type = CommandType::OtaUpdate;
        cmd.otaUrl = doc["value"] | "";
        if (cmd.otaUrl.isEmpty())
            return;
    }
    else
    {
        return;
    }

    handleCommand(cmd);
}

// --- Command handling ---

void OrtusSystem::handleCommand(const DeviceCommand &cmd)
{
    bool changed = false;

    if (cmd.type == CommandType::SetBrightness)
    {
        int b = constrain(cmd.brightness, 0, 100);
        if (currentState.brightness != b || currentState.lightCycleActive)
        {
            currentState.brightness = b;
            currentState.lightCycleActive = false;
            changed = true;
            updateActuators();
            broadcastState();
        }
    }
    else if (cmd.type == CommandType::SetLightSchedule)
    {
        if (currentState.lightCycleActive != cmd.scheduleActive ||
            currentState.lightCycleOnSeconds != cmd.cycleOnSeconds ||
            currentState.lightCycleOffSeconds != cmd.cycleOffSeconds ||
            currentState.lightCycleStartEpoch != cmd.start_at_epoch)
        {
            currentState.lightCycleActive = cmd.scheduleActive;
            if (cmd.scheduleActive)
            {
                currentState.lightCycleOnSeconds = cmd.cycleOnSeconds;
                currentState.lightCycleOffSeconds = cmd.cycleOffSeconds;
                currentState.lightCycleStartEpoch = cmd.start_at_epoch;
                lightCycleIsOnPhase = !cmd.startOff;
                lightCycleStartMillis = millis();
                currentState.brightness = lightCycleIsOnPhase ? 100 : 0;
                appliedBrightness = -1;
            }
            else
            {
                currentState.brightness = 0;
                appliedBrightness = -1;
            }
            changed = true;
            updateActuators();
            broadcastState();
            publishAck("setLightSchedule");
        }
    }
    else if (cmd.type == CommandType::SetIrrigationSchedule)
    {
        if (currentState.irrigationCycleActive != cmd.scheduleActive ||
            currentState.irrigationCycleOnSeconds != cmd.cycleOnSeconds ||
            currentState.irrigationCycleOffSeconds != cmd.cycleOffSeconds ||
            currentState.irrigationCycleStartEpoch != cmd.start_at_epoch)
        {
            currentState.irrigationCycleActive = cmd.scheduleActive;
            if (cmd.scheduleActive)
            {
                currentState.irrigationCycleOnSeconds = cmd.cycleOnSeconds;
                currentState.irrigationCycleOffSeconds = cmd.cycleOffSeconds;
                currentState.irrigationCycleStartEpoch = cmd.start_at_epoch;
                irrigationCycleIsOnPhase = !cmd.startOff;
                irrigationCycleStartMillis = millis();
                currentState.irrigationActive = irrigationCycleIsOnPhase;
            }
            else
            {
                currentState.irrigationActive = false;
            }
            changed = true;
            updateActuators();
            broadcastState();
            publishAck("setIrrigationSchedule");
        }
    }
    else if (cmd.type == CommandType::SetFanSchedule)
    {
        if (currentState.fanCycleActive != cmd.scheduleActive ||
            currentState.fanCycleOnSeconds != cmd.cycleOnSeconds ||
            currentState.fanCycleOffSeconds != cmd.cycleOffSeconds ||
            currentState.fanCycleStartEpoch != cmd.start_at_epoch)
        {
            currentState.fanCycleActive = cmd.scheduleActive;
            if (cmd.scheduleActive)
            {
                currentState.fanCycleOnSeconds = cmd.cycleOnSeconds;
                currentState.fanCycleOffSeconds = cmd.cycleOffSeconds;
                currentState.fanCycleStartEpoch = cmd.start_at_epoch;
                fanCycleIsOnPhase = !cmd.startOff;
                fanCycleStartMillis = millis();
                currentState.fanActive = fanCycleIsOnPhase;
            }
            else
            {
                currentState.fanActive = false;
            }
            changed = true;
            updateActuators();
            broadcastState();
            publishAck("setFanSchedule");
        }
    }
    else if (cmd.type == CommandType::OtaUpdate)
    {
        performOtaUpdate(cmd.otaUrl);
    }

    if (changed)
    {
        saveState();
    }
}

// --- Actuators ---

void OrtusSystem::updateActuators()
{
    // Light cycle
    if (currentState.lightCycleActive)
    {
        unsigned long duration = lightCycleIsOnPhase ? currentState.lightCycleOnSeconds : currentState.lightCycleOffSeconds;
        if (millis() - lightCycleStartMillis >= (duration * 1000))
        {
            lightCycleIsOnPhase = !lightCycleIsOnPhase;
            lightCycleStartMillis = millis();
            currentState.brightness = lightCycleIsOnPhase ? 100 : 0;
            appliedBrightness = -1;
            broadcastState();
        }
    }

    // Light PWM
    if (appliedBrightness != currentState.brightness)
    {
        appliedBrightness = currentState.brightness;
        int duty = (constrain(appliedBrightness, 0, 100) * 255) / 100;
        ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
        ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
    }

    // Irrigation cycle
    if (currentState.irrigationCycleActive)
    {
        unsigned long duration = irrigationCycleIsOnPhase ? currentState.irrigationCycleOnSeconds : currentState.irrigationCycleOffSeconds;
        if (millis() - irrigationCycleStartMillis >= (duration * 1000))
        {
            irrigationCycleIsOnPhase = !irrigationCycleIsOnPhase;
            irrigationCycleStartMillis = millis();
            currentState.irrigationActive = irrigationCycleIsOnPhase;
            broadcastState();
        }
    }
    digitalWrite(PIN_RELAY_IRRIGATION, currentState.irrigationActive ? HIGH : LOW);

    // Fan cycle
    if (currentState.fanCycleActive)
    {
        unsigned long duration = fanCycleIsOnPhase ? currentState.fanCycleOnSeconds : currentState.fanCycleOffSeconds;
        if (millis() - fanCycleStartMillis >= (duration * 1000))
        {
            fanCycleIsOnPhase = !fanCycleIsOnPhase;
            fanCycleStartMillis = millis();
            currentState.fanActive = fanCycleIsOnPhase;
            broadcastState();
        }
    }
    digitalWrite(PIN_RELAY_FAN, currentState.fanActive ? HIGH : LOW);
}

// --- Sensors ---

void OrtusSystem::updateSensors()
{
    unsigned long now = millis();

    if (now - lastTempPoll > TEMP_POLL_MS)
    {
        lastTempPoll = now;
        // Read the previous conversion
        float t = sensors.getTempCByIndex(0);
        // Start next conversion in background
        sensors.requestTemperatures();

        if (t > -50 && t < 150)
        {
            if (isnan(currentState.temperatureC) || fabs(t - currentState.temperatureC) > TEMP_DELTA_THRESHOLD)
            {
                currentState.temperatureC = t;
                broadcastState();
            }
        }
    }

    if (now - lastWaterPoll > WATER_POLL_MS)
    {
        lastWaterPoll = now;
        bool empty = (digitalRead(PIN_SENSOR_WATER) == LOW);
        if (empty != currentState.waterEmpty)
        {
            currentState.waterEmpty = empty;
            broadcastState();
        }
    }
}

// --- Broadcast & Presence ---

void OrtusSystem::broadcastState(bool force)
{
    if (!force && currentState == lastBroadcastState)
        return;
    lastBroadcastState = currentState;

    JsonDocument doc;
    doc["brightness"] = currentState.brightness;
    doc["irrigationActive"] = currentState.irrigationActive;
    doc["fanActive"] = currentState.fanActive;
    doc["temperature"] = currentState.temperatureC;
    doc["waterEmpty"] = currentState.waterEmpty;

    String json;
    serializeJson(doc, json);

    if (mqttClient.connected())
    {
        String topic = "ortus/" + macAddress + "/state";
        mqttClient.publish(topic.c_str(), json.c_str(), true);
    }

    wsServer.broadcastTXT(json);
}

void OrtusSystem::publishPresence()
{
    if (!mqttClient.connected())
        return;

    JsonDocument doc;
    doc["ip"] = WiFi.localIP().toString();
    doc["mac"] = macAddress;
    doc["uptime"] = millis() / 1000;

    String json;
    serializeJson(doc, json);
    String topic = "ortus/" + macAddress + "/presence";
    mqttClient.publish(topic.c_str(), json.c_str());
}

void OrtusSystem::publishAck(const String &cmdType)
{
    if (!mqttClient.connected())
        return;

    JsonDocument doc;
    doc["type"] = cmdType;
    String json;
    serializeJson(doc, json);

    String topic = "ortus/" + macAddress + "/ack";
    mqttClient.publish(topic.c_str(), json.c_str());
    Serial.println("[ACK] Published for " + cmdType);
}

// --- Persistence ---

void OrtusSystem::loadState()
{
    currentState.brightness = preferences.getInt("brightness", 0);

    currentState.lightCycleActive = preferences.getBool("lCycleActive", false);
    currentState.lightCycleOnSeconds = preferences.getULong("lCycleOn", 0);
    currentState.lightCycleOffSeconds = preferences.getULong("lCycleOff", 0);
    currentState.lightCycleStartEpoch = preferences.getULong("lCycleStart", 0);

    currentState.irrigationCycleActive = preferences.getBool("iCycleActive", false);
    currentState.irrigationCycleOnSeconds = preferences.getULong("iCycleOn", 0);
    currentState.irrigationCycleOffSeconds = preferences.getULong("iCycleOff", 0);
    currentState.irrigationCycleStartEpoch = preferences.getULong("iCycleStart", 0);

    currentState.fanCycleActive = preferences.getBool("fCycleActive", false);
    currentState.fanCycleOnSeconds = preferences.getULong("fCycleOn", 0);
    currentState.fanCycleOffSeconds = preferences.getULong("fCycleOff", 0);
    currentState.fanCycleStartEpoch = preferences.getULong("fCycleStart", 0);

    // Initial phase setup (will be refined by recoverSchedules if NTP is available)
    if (currentState.lightCycleActive)
    {
        lightCycleIsOnPhase = true;
        currentState.brightness = 100;
        lightCycleStartMillis = millis();
    }
    if (currentState.irrigationCycleActive)
    {
        irrigationCycleIsOnPhase = true;
        currentState.irrigationActive = true;
        irrigationCycleStartMillis = millis();
    }
    if (currentState.fanCycleActive)
    {
        fanCycleIsOnPhase = true;
        currentState.fanActive = true;
        fanCycleStartMillis = millis();
    }
}

void OrtusSystem::saveState()
{
    preferences.putInt("brightness", currentState.brightness);

    preferences.putBool("lCycleActive", currentState.lightCycleActive);
    preferences.putULong("lCycleOn", currentState.lightCycleOnSeconds);
    preferences.putULong("lCycleOff", currentState.lightCycleOffSeconds);
    preferences.putULong("lCycleStart", currentState.lightCycleStartEpoch);

    preferences.putBool("iCycleActive", currentState.irrigationCycleActive);
    preferences.putULong("iCycleOn", currentState.irrigationCycleOnSeconds);
    preferences.putULong("iCycleOff", currentState.irrigationCycleOffSeconds);
    preferences.putULong("iCycleStart", currentState.irrigationCycleStartEpoch);

    preferences.putBool("fCycleActive", currentState.fanCycleActive);
    preferences.putULong("fCycleOn", currentState.fanCycleOnSeconds);
    preferences.putULong("fCycleOff", currentState.fanCycleOffSeconds);
    preferences.putULong("fCycleStart", currentState.fanCycleStartEpoch);

    Serial.println("[System] State saved to NVS.");
}

void OrtusSystem::loadCredentials()
{
    wifiSSID = preferences.getString("ssid", DEFAULT_WIFI_SSID);
    wifiPass = preferences.getString("pass", DEFAULT_WIFI_PASSWORD);
}

void OrtusSystem::saveCredentials(String s, String p)
{
    preferences.putString("ssid", s);
    preferences.putString("pass", p);
    wifiSSID = s;
    wifiPass = p;
    Serial.println("[System] Credentials saved.");
}

// --- OTA ---

void OrtusSystem::performOtaUpdate(const String &url)
{
    Serial.println("[OTA] Starting update from: " + url);

    if (mqttClient.connected())
        mqttClient.publish(("ortus/" + macAddress + "/ota").c_str(), "started");

    WiFiClientSecure otaClient;
    otaClient.setInsecure();
    httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    t_httpUpdate_return ret = httpUpdate.update(otaClient, url);

    String error;
    switch (ret)
    {
    case HTTP_UPDATE_FAILED:
        error = httpUpdate.getLastErrorString();
        break;
    case HTTP_UPDATE_NO_UPDATES:
        error = "No update available";
        break;
    default:
        error = "Unknown error";
        break;
    }

    Serial.println("[OTA] " + error);
    if (mqttClient.connected())
        mqttClient.publish(("ortus/" + macAddress + "/ota").c_str(), ("failed: " + error).c_str());
}
