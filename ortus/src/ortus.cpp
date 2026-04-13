#include "ortus.h"
#include <ArduinoJson.h>
#include "driver/ledc.h"

OrtusSystem *OrtusSystem::instance = nullptr;

OrtusSystem::OrtusSystem()
    : mqttClient(wifiClient),
      wsServer(WS_SERVER_PORT),
      oneWire(PIN_SENSOR_TEMP)
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

    // Initial DS18B20 setup
    oneWire.reset();
    oneWire.write(0xCC);
    oneWire.write(0x44, 1);

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

        if (millis() - lastStateBroadcast > STATE_INTERVAL_MS)
        {
            broadcastState(true);
            lastStateBroadcast = millis();
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

    // Light Schedule Recovery
    if (currentState.lightScheduleActive && currentState.lightScheduleStartEpoch > 0)
    {
        unsigned long totalCycle = currentState.lightScheduleOnSeconds + currentState.lightScheduleOffSeconds;
        if (totalCycle > 0)
        {
            unsigned long elapsed = currentEpoch - currentState.lightScheduleStartEpoch;
            unsigned long position = elapsed % totalCycle;

            if (position < currentState.lightScheduleOnSeconds)
            {
                lightIsOnPhase = true;
                lightPhaseStartMillis = millis() - (position * 1000);
            }
            else
            {
                lightIsOnPhase = false;
                lightPhaseStartMillis = millis() - ((position - currentState.lightScheduleOnSeconds) * 1000);
            }
            currentState.brightness = lightIsOnPhase ? 100 : 0;
            currentState.lightOn = lightIsOnPhase;
            appliedBrightness = -1;
            Serial.println("[Schedule] Light schedule recovered");
        }
    }

    // Irrigation Schedule Recovery
    if (currentState.irrigationScheduleActive && currentState.irrigationScheduleStartEpoch > 0)
    {
        unsigned long totalCycle = currentState.irrigationScheduleOnSeconds + currentState.irrigationScheduleOffSeconds;
        if (totalCycle > 0)
        {
            unsigned long elapsed = currentEpoch - currentState.irrigationScheduleStartEpoch;
            unsigned long position = elapsed % totalCycle;

            if (position < currentState.irrigationScheduleOnSeconds)
            {
                irrigationIsOnPhase = true;
                irrigationPhaseStartMillis = millis() - (position * 1000);
            }
            else
            {
                irrigationIsOnPhase = false;
                irrigationPhaseStartMillis = millis() - ((position - currentState.irrigationScheduleOnSeconds) * 1000);
            }
            currentState.irrigationOn = irrigationIsOnPhase;
            Serial.println("[Schedule] Irrigation schedule recovered");
        }
    }

    // Fan Schedule Recovery
    if (currentState.fanScheduleActive && currentState.fanScheduleStartEpoch > 0)
    {
        unsigned long totalCycle = currentState.fanScheduleOnSeconds + currentState.fanScheduleOffSeconds;
        if (totalCycle > 0)
        {
            unsigned long elapsed = currentEpoch - currentState.fanScheduleStartEpoch;
            unsigned long position = elapsed % totalCycle;

            if (position < currentState.fanScheduleOnSeconds)
            {
                fanIsOnPhase = true;
                fanPhaseStartMillis = millis() - (position * 1000);
            }
            else
            {
                fanIsOnPhase = false;
                fanPhaseStartMillis = millis() - ((position - currentState.fanScheduleOnSeconds) * 1000);
            }
            currentState.fanOn = fanIsOnPhase;
            Serial.println("[Schedule] Fan schedule recovered");
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
        if (currentState.brightness != b || currentState.lightScheduleActive)
        {
            currentState.brightness = b;
            currentState.lightOn = b > 0;
            currentState.lightScheduleActive = false;
            changed = true;
            updateActuators();
            broadcastState();
        }
    }
    else if (cmd.type == CommandType::SetLightSchedule)
    {
        if (currentState.lightScheduleActive != cmd.scheduleActive ||
            currentState.lightScheduleOnSeconds != cmd.cycleOnSeconds ||
            currentState.lightScheduleOffSeconds != cmd.cycleOffSeconds ||
            currentState.lightScheduleStartEpoch != cmd.start_at_epoch)
        {
            currentState.lightScheduleActive = cmd.scheduleActive;
            if (cmd.scheduleActive)
            {
                currentState.lightScheduleOnSeconds = cmd.cycleOnSeconds;
                currentState.lightScheduleOffSeconds = cmd.cycleOffSeconds;
                currentState.lightScheduleStartEpoch = cmd.start_at_epoch;
                lightIsOnPhase = !cmd.startOff;
                lightPhaseStartMillis = millis();
                currentState.brightness = lightIsOnPhase ? 100 : 0;
                currentState.lightOn = lightIsOnPhase;
                appliedBrightness = -1;
            }
            else
            {
                currentState.brightness = 0;
                currentState.lightOn = false;
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
        if (currentState.irrigationScheduleActive != cmd.scheduleActive ||
            currentState.irrigationScheduleOnSeconds != cmd.cycleOnSeconds ||
            currentState.irrigationScheduleOffSeconds != cmd.cycleOffSeconds ||
            currentState.irrigationScheduleStartEpoch != cmd.start_at_epoch)
        {
            currentState.irrigationScheduleActive = cmd.scheduleActive;
            if (cmd.scheduleActive)
            {
                currentState.irrigationScheduleOnSeconds = cmd.cycleOnSeconds;
                currentState.irrigationScheduleOffSeconds = cmd.cycleOffSeconds;
                currentState.irrigationScheduleStartEpoch = cmd.start_at_epoch;
                irrigationIsOnPhase = !cmd.startOff;
                irrigationPhaseStartMillis = millis();
                currentState.irrigationOn = irrigationIsOnPhase;
            }
            else
            {
                currentState.irrigationOn = false;
            }
            changed = true;
            updateActuators();
            broadcastState();
            publishAck("setIrrigationSchedule");
        }
    }
    else if (cmd.type == CommandType::SetFanSchedule)
    {
        if (currentState.fanScheduleActive != cmd.scheduleActive ||
            currentState.fanScheduleOnSeconds != cmd.cycleOnSeconds ||
            currentState.fanScheduleOffSeconds != cmd.cycleOffSeconds ||
            currentState.fanScheduleStartEpoch != cmd.start_at_epoch)
        {
            currentState.fanScheduleActive = cmd.scheduleActive;
            if (cmd.scheduleActive)
            {
                currentState.fanScheduleOnSeconds = cmd.cycleOnSeconds;
                currentState.fanScheduleOffSeconds = cmd.cycleOffSeconds;
                currentState.fanScheduleStartEpoch = cmd.start_at_epoch;
                fanIsOnPhase = !cmd.startOff;
                fanPhaseStartMillis = millis();
                currentState.fanOn = fanIsOnPhase;
            }
            else
            {
                currentState.fanOn = false;
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
    // Light schedule
    if (currentState.lightScheduleActive)
    {
        unsigned long duration = lightIsOnPhase ? currentState.lightScheduleOnSeconds : currentState.lightScheduleOffSeconds;
        if (millis() - lightPhaseStartMillis >= (duration * 1000))
        {
            lightIsOnPhase = !lightIsOnPhase;
            lightPhaseStartMillis = millis();
            currentState.brightness = lightIsOnPhase ? 100 : 0;
            currentState.lightOn = lightIsOnPhase;
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

    // Irrigation schedule
    if (currentState.irrigationScheduleActive)
    {
        unsigned long duration = irrigationIsOnPhase ? currentState.irrigationScheduleOnSeconds : currentState.irrigationScheduleOffSeconds;
        if (millis() - irrigationPhaseStartMillis >= (duration * 1000))
        {
            irrigationIsOnPhase = !irrigationIsOnPhase;
            irrigationPhaseStartMillis = millis();
            currentState.irrigationOn = irrigationIsOnPhase;
            broadcastState();
        }
    }
    digitalWrite(PIN_RELAY_IRRIGATION, currentState.irrigationOn ? HIGH : LOW);

    // Fan schedule
    if (currentState.fanScheduleActive)
    {
        unsigned long duration = fanIsOnPhase ? currentState.fanScheduleOnSeconds : currentState.fanScheduleOffSeconds;
        if (millis() - fanPhaseStartMillis >= (duration * 1000))
        {
            fanIsOnPhase = !fanIsOnPhase;
            fanPhaseStartMillis = millis();
            currentState.fanOn = fanIsOnPhase;
            broadcastState();
        }
    }
    digitalWrite(PIN_RELAY_FAN, currentState.fanOn ? HIGH : LOW);
}

// --- Sensors ---

void OrtusSystem::updateSensors()
{
    unsigned long now = millis();

    if (now - lastTempPoll > TEMP_POLL_MS)
    {
        lastTempPoll = now;
        byte data[2];
        int16_t result;

        if (oneWire.reset())
        {
            oneWire.write(0xCC);
            oneWire.write(0xBE);

            for (int i = 0; i < 2; i++)
            {
                data[i] = oneWire.read();
            }

            result = (data[1] << 8) | data[0];
            float t = (float)result * 0.0625;

            // Start next conversion in background
            oneWire.reset();
            oneWire.write(0xCC);
            oneWire.write(0x44, 1);

            if (t > -100 && t < 150)
            {
                if (isnan(currentState.temperatureC) || fabs(t - currentState.temperatureC) > TEMP_DELTA_THRESHOLD)
                {
                    currentState.temperatureC = t;
                    broadcastState();
                }
            }
        }
    }

    if (now - lastWaterPoll > WATER_POLL_MS)
    {
        lastWaterPoll = now;
        int rawLiquidRead = digitalRead(PIN_SENSOR_WATER); // LOW = Detected

        if (rawLiquidRead == LOW)
        {
            if (waterDetectionStart == 0)
            {
                waterDetectionStart = millis();
            }

            if (millis() - waterDetectionStart > WATER_SENSITIVITY_MS)
            {
                if (!waterConfirmed)
                {
                    Serial.println(">>> LIQUID CONFIRMED <<<");
                    waterConfirmed = true;
                }
            }
        }
        else
        {
            waterDetectionStart = 0;
            if (waterConfirmed)
            {
                Serial.println(">>> NO LIQUID <<<");
                waterConfirmed = false;
            }
        }

        bool waterEmpty = !waterConfirmed;
        if (waterEmpty != currentState.waterEmpty)
        {
            currentState.waterEmpty = waterEmpty;
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
    doc["lightOn"] = currentState.lightOn;
    doc["lightScheduleActive"] = currentState.lightScheduleActive;
    doc["irrigationOn"] = currentState.irrigationOn;
    doc["irrigationScheduleActive"] = currentState.irrigationScheduleActive;
    doc["fanOn"] = currentState.fanOn;
    doc["fanScheduleActive"] = currentState.fanScheduleActive;
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

    currentState.lightScheduleActive = preferences.getBool("lCycleActive", false);
    currentState.lightScheduleOnSeconds = preferences.getULong("lCycleOn", 0);
    currentState.lightScheduleOffSeconds = preferences.getULong("lCycleOff", 0);
    currentState.lightScheduleStartEpoch = preferences.getULong("lCycleStart", 0);

    currentState.irrigationScheduleActive = preferences.getBool("iCycleActive", false);
    currentState.irrigationScheduleOnSeconds = preferences.getULong("iCycleOn", 0);
    currentState.irrigationScheduleOffSeconds = preferences.getULong("iCycleOff", 0);
    currentState.irrigationScheduleStartEpoch = preferences.getULong("iCycleStart", 0);

    currentState.fanScheduleActive = preferences.getBool("fCycleActive", false);
    currentState.fanScheduleOnSeconds = preferences.getULong("fCycleOn", 0);
    currentState.fanScheduleOffSeconds = preferences.getULong("fCycleOff", 0);
    currentState.fanScheduleStartEpoch = preferences.getULong("fCycleStart", 0);

    // Initial phase setup (will be refined by recoverSchedules if NTP is available)
    if (currentState.lightScheduleActive)
    {
        lightIsOnPhase = true;
        currentState.brightness = 100;
        currentState.lightOn = true;
        lightPhaseStartMillis = millis();
    }
    if (currentState.irrigationScheduleActive)
    {
        irrigationIsOnPhase = true;
        currentState.irrigationOn = true;
        irrigationPhaseStartMillis = millis();
    }
    if (currentState.fanScheduleActive)
    {
        fanIsOnPhase = true;
        currentState.fanOn = true;
        fanPhaseStartMillis = millis();
    }
}

void OrtusSystem::saveState()
{
    preferences.putInt("brightness", currentState.brightness);

    preferences.putBool("lCycleActive", currentState.lightScheduleActive);
    preferences.putULong("lCycleOn", currentState.lightScheduleOnSeconds);
    preferences.putULong("lCycleOff", currentState.lightScheduleOffSeconds);
    preferences.putULong("lCycleStart", currentState.lightScheduleStartEpoch);

    preferences.putBool("iCycleActive", currentState.irrigationScheduleActive);
    preferences.putULong("iCycleOn", currentState.irrigationScheduleOnSeconds);
    preferences.putULong("iCycleOff", currentState.irrigationScheduleOffSeconds);
    preferences.putULong("iCycleStart", currentState.irrigationScheduleStartEpoch);

    preferences.putBool("fCycleActive", currentState.fanScheduleActive);
    preferences.putULong("fCycleOn", currentState.fanScheduleOnSeconds);
    preferences.putULong("fCycleOff", currentState.fanScheduleOffSeconds);
    preferences.putULong("fCycleStart", currentState.fanScheduleStartEpoch);

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
