#include "ortus.h"
#include <ArduinoJson.h>

OrtusSystem* OrtusSystem::instance = nullptr;

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
    while(!Serial && millis() - start < 2000) delay(10);

    Serial.println("\n[System] Ortus Starting...");
    
    // Hardware Setup
    pinMode(PIN_RELAY_PUMP, OUTPUT);
    pinMode(PIN_RELAY_FAN, OUTPUT);
    pinMode(PIN_SENSOR_WATER, INPUT);
    
    // Initial relay state (Active LOW assumed from original code)
    digitalWrite(PIN_RELAY_PUMP, HIGH);
    digitalWrite(PIN_RELAY_FAN, HIGH);

    ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RES);
    ledcAttachPin(PIN_PWM_LIGHT, PWM_CHANNEL);
    
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
        [this](String s, String p) { saveCredentials(s, p); },
        [this]() { 
            Serial.println("[System] Credentials updated via BLE. Reconnecting...");
            WiFi.disconnect(true);
            lastWifiAttempt = 0; // Force immediate retry
        }
    );
    
    Serial.println("[System] Boot complete.");
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

    wifiConnected = false;
    ble.updateWiFiState(false);

    if (wifiSSID.isEmpty()) return; // No credentials

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
    if (mqttClient.connected()) return;

    static unsigned long lastMqttAttempt = 0;
    if (millis() - lastMqttAttempt < 5000) return;
    lastMqttAttempt = millis();

    Serial.print("[MQTT] Connecting...");
    String clientId = "Ortus-" + macAddress;
    
    if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD))
    {
        Serial.println("Connected");
        
        // Subscribe
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
    if (instance) instance->onMqttMessage(topic, payload, length);
}

void OrtusSystem::onMqttMessage(char *topic, uint8_t *payload, unsigned int length)
{
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);
    
    if (error)
    {
        Serial.println("[MQTT] JSON Error");
        return;
    }

    DeviceCommand cmd;
    if (doc["type"] == "brightness")
    {
        cmd.type = CommandType::SetBrightness;
        cmd.brightness = doc["value"] | 0;
    }
    else if (doc["type"] == "pump")
    {
        cmd.type = CommandType::TriggerPump;
        cmd.pumpDurationSeconds = doc["duration"] | 60;
    }
    
    handleCommand(cmd);
}

// --- WebSocket ---

void OrtusSystem::webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length)
{
    if (instance) instance->onWebSocketMessage(num, type, payload, length);
}

void OrtusSystem::onWebSocketMessage(uint8_t num, WStype_t type, uint8_t *payload, size_t length)
{
    if (type == WStype_TEXT)
    {
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, payload, length);
        if (!error)
        {
             // Simplified command handling reuse
            DeviceCommand cmd;
            String typeStr = doc["type"].as<String>();
            
            if (typeStr == "setBrightness")
            {
                cmd.type = CommandType::SetBrightness;
                cmd.brightness = doc["payload"]["brightness"];
                handleCommand(cmd);
            }
            else if (typeStr == "triggerPump")
            {
                cmd.type = CommandType::TriggerPump;
                cmd.pumpDurationSeconds = doc["payload"]["duration"];
                handleCommand(cmd);
            }
        }
    }
    else if (type == WStype_CONNECTED)
    {
        // Send current state on connect
        broadcastState(true);
    }
}

// --- Logic ---

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
    else if (cmd.type == CommandType::TriggerPump)
    {
        if (cmd.pumpDurationSeconds > 0)
        {
            pumpStopAt = millis() + (cmd.pumpDurationSeconds * 1000);
            currentState.pumpActive = true;
            updateActuators();
            broadcastState();
        }
    }
}

void OrtusSystem::updateActuators()
{
    // Brightness (PWM)
    if (appliedBrightness != currentState.brightness)
    {
        appliedBrightness = currentState.brightness;
        int duty = map(appliedBrightness, 0, 100, 0, 255);
        ledcWrite(PWM_CHANNEL, duty);
    }

    // Pump
    if (currentState.pumpActive)
    {
        if (millis() >= pumpStopAt)
        {
            currentState.pumpActive = false;
            pumpStopAt = 0;
            broadcastState();
        }
    }
    digitalWrite(PIN_RELAY_PUMP, currentState.pumpActive ? LOW : HIGH);

    // Fan Logic
    bool fanOn = false;
    if (currentState.pumpActive) fanOn = true;
    else if (currentState.temperatureC >= FAN_ON_TEMP_C) fanOn = true;
    else if (currentState.temperatureC <= FAN_OFF_TEMP_C) fanOn = false;
    else fanOn = currentState.fanActive; // Hysteresis hold
    
    if (fanOn != currentState.fanActive)
    {
        currentState.fanActive = fanOn;
        broadcastState();
    }
    digitalWrite(PIN_RELAY_FAN, currentState.fanActive ? LOW : HIGH);
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
        int raw = analogRead(PIN_SENSOR_WATER);
        
        bool empty = currentState.waterEmpty;
        if (empty && raw > (WATER_EMPTY_THRESHOLD + WATER_HYSTERESIS)) empty = false;
        else if (!empty && raw < (WATER_EMPTY_THRESHOLD - WATER_HYSTERESIS)) empty = true;
        
        if (empty != currentState.waterEmpty)
        {
            currentState.waterEmpty = empty;
            broadcastState();
        }
    }
}

void OrtusSystem::broadcastState(bool force)
{
    if (!force && currentState == lastBroadcastState) return;
    lastBroadcastState = currentState;
    
    JsonDocument doc;
    doc["brightness"] = currentState.brightness;
    doc["pumpActive"] = currentState.pumpActive;
    doc["fanActive"] = currentState.fanActive;
    doc["temperature"] = currentState.temperatureC;
    doc["waterEmpty"] = currentState.waterEmpty;
    
    String json;
    serializeJson(doc, json);
    
    // MQTT
    if (mqttClient.connected())
    {
        String topic = "ortus/" + macAddress + "/state";
        mqttClient.publish(topic.c_str(), json.c_str(), true);
    }
    
    // WebSocket
    wsServer.broadcastTXT(json);
}

void OrtusSystem::publishPresence()
{
    if (!mqttClient.connected()) return;
    
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
