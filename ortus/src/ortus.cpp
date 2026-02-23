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
    // Wait for serial (optional, mainly for dev)
    unsigned long start = millis();
    while (!Serial && millis() - start < 2000)
        delay(10);

    Serial.println("\n[System] Ortus Starting...");

    // Hardware Setup
    pinMode(PIN_RELAY_IRRIGATION, OUTPUT);
    pinMode(PIN_SENSOR_WATER, INPUT_PULLUP);

    // Initial relay state (Active LOW assumed from original code)
    digitalWrite(PIN_RELAY_IRRIGATION, HIGH);

    // Setup LEDC PWM for light dimming
    ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_8_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = 10000,
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

    // Load Data
    preferences.begin("ortus", false);
    loadCredentials();
    loadState();

    // Apply initial state
    appliedBrightness = -1; // Force update
    updateActuators();

    // Network Setup
    setupWiFi();
    setupMQTT();

    wsServer.begin();
    wsServer.onEvent(webSocketEvent);

    // BLE Setup
    ble.begin(
        [this](String s, String p)
        { saveCredentials(s, p); },
        [this]()
        {
            Serial.println("[System] Credentials updated via BLE. Reconnecting...");
            WiFi.disconnect(true);
            lastWifiAttempt = 0; // Force immediate retry
        });

    Serial.println("[System] Boot complete.");

    if (WiFi.status() != WL_CONNECTED)
    {
        ble.updateWiFiState(false);
    }
}

void OrtusSystem::loop()
{
    ble.loop();
    wsServer.loop();

    connectWiFi(); // Manage connection

    if (wifiConnected)
    {
        connectMQTT();
        mqttClient.loop();

        // Periodic Presence
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
            publishPresence(); // Immediate presence on connect
        }
        return;
    }

    if (wifiConnected)
    {
        wifiConnected = false;
        ble.updateWiFiState(false);
    }

    if (wifiSSID.isEmpty())
        return; // No credentials

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
    wifiClient.setInsecure(); // For HiveMQ or similar without cert validation
    mqttClient.setServer(MQTT_BROKER_HOST, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setBufferSize(1024); // Increase buffer for JSON
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

        // Publish online status (retained)
        mqttClient.publish(lwtTopic.c_str(), "online", true);

        // Subscribe to unified command topic
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
    // MQTT now uses the exact same JSON format as WebSockets
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
    {
        processRawCommand(payload, length);
    }
    else if (type == WStype_CONNECTED)
    {
        // Send current state on connect
        broadcastState(true);
    }
}

// --- Logic ---

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

    // Unified command parsing
    // Supports strictly { "type": "...", "value": ... }
    if (type == "setBrightness")
    {
        cmd.type = CommandType::SetBrightness;
        if (!doc["value"].isNull())
            cmd.brightness = doc["value"];
        else
            return;
    }
    else if (type == "triggerIrrigation")
    {
        cmd.type = CommandType::TriggerIrrigation;
        if (!doc["value"].isNull())
            cmd.irrigationDurationSeconds = doc["value"];
        else
            cmd.irrigationDurationSeconds = 60; // Default
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
        return; // Unknown command
    }

    handleCommand(cmd);
}

void OrtusSystem::handleCommand(const DeviceCommand &cmd)
{
    if (cmd.type == CommandType::SetBrightness)
    {
        int b = constrain(cmd.brightness, 0, 100);
        if (currentState.brightness != b)
        {
            currentState.brightness = b;
            saveState();
            updateActuators();
            broadcastState();
        }
    }
    else if (cmd.type == CommandType::TriggerIrrigation)
    {
        if (cmd.irrigationDurationSeconds > 0)
        {
            irrigationStopAt = millis() + (cmd.irrigationDurationSeconds * 1000);
            currentState.irrigationActive = true;
            updateActuators();
            broadcastState();
        }
    }
    else if (cmd.type == CommandType::OtaUpdate)
    {
        performOtaUpdate(cmd.otaUrl);
    }
}

void OrtusSystem::updateActuators()
{
    // Light (PWM dimming via LEDC)
    if (appliedBrightness != currentState.brightness)
    {
        appliedBrightness = currentState.brightness;
        int duty = (constrain(appliedBrightness, 0, 100) * 255) / 100;
        ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
        ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
    }

    // Irrigation
    if (currentState.irrigationActive)
    {
        if (millis() >= irrigationStopAt)
        {
            currentState.irrigationActive = false;
            irrigationStopAt = 0;
            broadcastState();
        }
    }
    digitalWrite(PIN_RELAY_IRRIGATION, currentState.irrigationActive ? HIGH : LOW);
}

void OrtusSystem::updateSensors()
{
    unsigned long now = millis();

    // Temperature
    if (now - lastTempPoll > TEMP_POLL_MS)
    {
        lastTempPoll = now;
        sensors.requestTemperatures();
        float t = sensors.getTempCByIndex(0);
        if (t > -50 && t < 150) // Basic validation
        {
            if (isnan(currentState.temperatureC) || fabs(t - currentState.temperatureC) > TEMP_DELTA_THRESHOLD)
            {
                currentState.temperatureC = t;
                broadcastState();
            }
        }
    }

    // Water Level
    if (now - lastWaterPoll > WATER_POLL_MS)
    {
        lastWaterPoll = now;
        int val = digitalRead(PIN_SENSOR_WATER);

        // Previous analog logic: > 1.5V = Not Empty, < 1.5V = Empty.
        // Mapping to digital: HIGH (Pullup) = Not Empty, LOW (Grounded) = Empty.
        bool empty = (val == LOW);

        if (empty != currentState.waterEmpty)
        {
            currentState.waterEmpty = empty;
            broadcastState();
        }
    }
}

void OrtusSystem::broadcastState(bool force)
{
    if (!force && currentState == lastBroadcastState)
        return;
    lastBroadcastState = currentState;

    JsonDocument doc;
    doc["brightness"] = currentState.brightness;
    doc["irrigationActive"] = currentState.irrigationActive;
    doc["temperature"] = currentState.temperatureC;
    doc["waterEmpty"] = currentState.waterEmpty;

    String json;
    serializeJson(doc, json);

    // MQTT: Publish full state as JSON
    if (mqttClient.connected())
    {
        String topic = "ortus/" + macAddress + "/state";
        mqttClient.publish(topic.c_str(), json.c_str(), true);
    }

    // WebSocket: Same JSON
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

// --- Persistence ---

void OrtusSystem::loadState()
{
    currentState.brightness = preferences.getInt("brightness", 0);
}

void OrtusSystem::saveState()
{
    preferences.putInt("brightness", currentState.brightness);
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

void OrtusSystem::performOtaUpdate(const String &url)
{
    Serial.println("[OTA] Starting update from: " + url);

    // Publish status so the app knows we're updating
    if (mqttClient.connected())
    {
        String topic = "ortus/" + macAddress + "/ota";
        mqttClient.publish(topic.c_str(), "started");
    }

    WiFiClientSecure otaClient;
    otaClient.setInsecure(); // Skip cert validation (same as your MQTT client)

    httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    t_httpUpdate_return ret = httpUpdate.update(otaClient, url);

    // If we get here, the update failed (success would reboot automatically)
    String error;
    switch (ret)
    {
    case HTTP_UPDATE_FAILED:
        error = httpUpdate.getLastErrorString();
        Serial.println("[OTA] Failed: " + error);
        break;
    case HTTP_UPDATE_NO_UPDATES:
        error = "No update available";
        Serial.println("[OTA] " + error);
        break;
    default:
        error = "Unknown error";
        break;
    }

    if (mqttClient.connected())
    {
        String topic = "ortus/" + macAddress + "/ota";
        mqttClient.publish(topic.c_str(), ("failed: " + error).c_str());
    }
}
