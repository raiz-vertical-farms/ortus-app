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
    if (WiFi.status() == WL_CONNECTED)
    {
        if (!wifiConnected)
        {
            wifiConnected = true;
            Serial.println("[WiFi] Connected! IP: " + WiFi.localIP().toString());
            ble.updateWiFiState(true);
            publishPresence();
        }
        return;
    }

    if (wifiConnected)
    {
        wifiConnected = false;
        ble.updateWiFiState(false);
    }

    if (wifiSSID.isEmpty())
        return;

    if (millis() - lastWifiAttempt > 10000)
    {
        lastWifiAttempt = millis();
        Serial.println("[WiFi] Connecting to " + wifiSSID + "...");
        WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
    }
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
    else if (type == "setLightSchedule")
    {
        cmd.type = CommandType::SetLightSchedule;
        cmd.scheduleActive = doc["active"] | false;
        cmd.cycleOnSeconds = (unsigned long)(doc["minutes_on"] | 0) * 60;
        cmd.cycleOffSeconds = (unsigned long)(doc["minutes_off"] | 0) * 60;
        cmd.startOff = doc["start_off"] | false;
    }
    else if (type == "setIrrigationSchedule")
    {
        cmd.type = CommandType::SetIrrigationSchedule;
        cmd.scheduleActive = doc["active"] | false;
        cmd.cycleOnSeconds = (unsigned long)(doc["minutes_on"] | 0) * 60;
        cmd.cycleOffSeconds = (unsigned long)(doc["minutes_off"] | 0) * 60;
        cmd.startOff = doc["start_off"] | false;
    }
    else if (type == "setFanSchedule")
    {
        cmd.type = CommandType::SetFanSchedule;
        cmd.scheduleActive = doc["active"] | false;
        cmd.cycleOnSeconds = (unsigned long)(doc["minutes_on"] | 0) * 60;
        cmd.cycleOffSeconds = (unsigned long)(doc["minutes_off"] | 0) * 60;
        cmd.startOff = doc["start_off"] | false;
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
    if (cmd.type == CommandType::SetBrightness)
    {
        int b = constrain(cmd.brightness, 0, 100);
        if (currentState.brightness != b)
        {
            currentState.brightness = b;
            // Turning brightness on/off cancels the light cycle
            currentState.lightCycleActive = false;
            saveState();
            updateActuators();
            broadcastState();
        }
    }
    else if (cmd.type == CommandType::SetLightSchedule)
    {
        currentState.lightCycleActive = cmd.scheduleActive;
        if (cmd.scheduleActive)
        {
            currentState.lightCycleOnSeconds = cmd.cycleOnSeconds;
            currentState.lightCycleOffSeconds = cmd.cycleOffSeconds;
            // Determine initial phase
            lightCycleIsOnPhase = !cmd.startOff;
            unsigned long firstDuration = lightCycleIsOnPhase ? cmd.cycleOnSeconds : cmd.cycleOffSeconds;
            lightCycleNextToggle = millis() + (firstDuration * 1000);
            currentState.brightness = lightCycleIsOnPhase ? 100 : 0;
            appliedBrightness = -1;
        }
        else
        {
            currentState.brightness = 0;
            appliedBrightness = -1;
        }
        saveState();
        updateActuators();
        broadcastState();
        publishAck("setLightSchedule");
    }
    else if (cmd.type == CommandType::SetIrrigationSchedule)
    {
        currentState.irrigationCycleActive = cmd.scheduleActive;
        if (cmd.scheduleActive)
        {
            currentState.irrigationCycleOnSeconds = cmd.cycleOnSeconds;
            currentState.irrigationCycleOffSeconds = cmd.cycleOffSeconds;
            irrigationCycleIsOnPhase = !cmd.startOff;
            unsigned long firstDuration = irrigationCycleIsOnPhase ? cmd.cycleOnSeconds : cmd.cycleOffSeconds;
            irrigationCycleNextToggle = millis() + (firstDuration * 1000);
            currentState.irrigationActive = irrigationCycleIsOnPhase;
        }
        else
        {
            currentState.irrigationActive = false;
        }
        saveState();
        updateActuators();
        broadcastState();
        publishAck("setIrrigationSchedule");
    }
    else if (cmd.type == CommandType::SetFanSchedule)
    {
        currentState.fanCycleActive = cmd.scheduleActive;
        if (cmd.scheduleActive)
        {
            currentState.fanCycleOnSeconds = cmd.cycleOnSeconds;
            currentState.fanCycleOffSeconds = cmd.cycleOffSeconds;
            fanCycleIsOnPhase = !cmd.startOff;
            unsigned long firstDuration = fanCycleIsOnPhase ? cmd.cycleOnSeconds : cmd.cycleOffSeconds;
            fanCycleNextToggle = millis() + (firstDuration * 1000);
            currentState.fanActive = fanCycleIsOnPhase;
        }
        else
        {
            currentState.fanActive = false;
        }
        saveState();
        updateActuators();
        broadcastState();
        publishAck("setFanSchedule");
    }
    else if (cmd.type == CommandType::OtaUpdate)
    {
        performOtaUpdate(cmd.otaUrl);
    }
}

// --- Actuators ---

void OrtusSystem::updateActuators()
{
    // Light cycle toggle
    if (currentState.lightCycleActive && millis() >= lightCycleNextToggle)
    {
        lightCycleIsOnPhase = !lightCycleIsOnPhase;
        currentState.brightness = lightCycleIsOnPhase ? 100 : 0;
        appliedBrightness = -1;
        unsigned long duration = lightCycleIsOnPhase ? currentState.lightCycleOnSeconds : currentState.lightCycleOffSeconds;
        lightCycleNextToggle = millis() + (duration * 1000);
        broadcastState();
    }

    // Light PWM
    if (appliedBrightness != currentState.brightness)
    {
        appliedBrightness = currentState.brightness;
        int duty = (constrain(appliedBrightness, 0, 100) * 255) / 100;
        ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
        ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
    }

    // Irrigation cycle toggle
    if (currentState.irrigationCycleActive && millis() >= irrigationCycleNextToggle)
    {
        irrigationCycleIsOnPhase = !irrigationCycleIsOnPhase;
        currentState.irrigationActive = irrigationCycleIsOnPhase;
        unsigned long duration = irrigationCycleIsOnPhase ? currentState.irrigationCycleOnSeconds : currentState.irrigationCycleOffSeconds;
        irrigationCycleNextToggle = millis() + (duration * 1000);
        broadcastState();
    }
    digitalWrite(PIN_RELAY_IRRIGATION, currentState.irrigationActive ? HIGH : LOW);

    // Fan cycle toggle
    if (currentState.fanCycleActive && millis() >= fanCycleNextToggle)
    {
        fanCycleIsOnPhase = !fanCycleIsOnPhase;
        currentState.fanActive = fanCycleIsOnPhase;
        unsigned long duration = fanCycleIsOnPhase ? currentState.fanCycleOnSeconds : currentState.fanCycleOffSeconds;
        fanCycleNextToggle = millis() + (duration * 1000);
        broadcastState();
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
        sensors.requestTemperatures();
        float t = sensors.getTempCByIndex(0);
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
    if (currentState.lightCycleActive)
    {
        lightCycleIsOnPhase = true;
        currentState.brightness = 100;
        appliedBrightness = -1;
        lightCycleNextToggle = millis() + (currentState.lightCycleOnSeconds * 1000);
    }

    currentState.irrigationCycleActive = preferences.getBool("iCycleActive", false);
    currentState.irrigationCycleOnSeconds = preferences.getULong("iCycleOn", 0);
    currentState.irrigationCycleOffSeconds = preferences.getULong("iCycleOff", 0);
    if (currentState.irrigationCycleActive)
    {
        irrigationCycleIsOnPhase = true;
        currentState.irrigationActive = true;
        irrigationCycleNextToggle = millis() + (currentState.irrigationCycleOnSeconds * 1000);
    }

    currentState.fanCycleActive = preferences.getBool("fCycleActive", false);
    currentState.fanCycleOnSeconds = preferences.getULong("fCycleOn", 0);
    currentState.fanCycleOffSeconds = preferences.getULong("fCycleOff", 0);
    if (currentState.fanCycleActive)
    {
        fanCycleIsOnPhase = true;
        currentState.fanActive = true;
        fanCycleNextToggle = millis() + (currentState.fanCycleOnSeconds * 1000);
    }
}

void OrtusSystem::saveState()
{
    preferences.putInt("brightness", currentState.brightness);

    preferences.putBool("lCycleActive", currentState.lightCycleActive);
    preferences.putULong("lCycleOn", currentState.lightCycleOnSeconds);
    preferences.putULong("lCycleOff", currentState.lightCycleOffSeconds);

    preferences.putBool("iCycleActive", currentState.irrigationCycleActive);
    preferences.putULong("iCycleOn", currentState.irrigationCycleOnSeconds);
    preferences.putULong("iCycleOff", currentState.irrigationCycleOffSeconds);

    preferences.putBool("fCycleActive", currentState.fanCycleActive);
    preferences.putULong("fCycleOn", currentState.fanCycleOnSeconds);
    preferences.putULong("fCycleOff", currentState.fanCycleOffSeconds);
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
