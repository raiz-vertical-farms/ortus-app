#include "ortus.h"
#include <ArduinoJson.h>
#include "driver/ledc.h"
#include "esp_task_wdt.h"

OrtusSystem *OrtusSystem::instance = nullptr;

// Fault-recovery escalation timings.
// If WiFi or MQTT can't connect for this long, nuke ESP-IDF's cached AP/BSSID
// (the thing that survives a power cycle) and restart the stack from scratch.
// If even that doesn't help within the reboot threshold, hard-reboot.
static const unsigned long WIFI_HARD_RESET_AFTER_MS = 5UL * 60UL * 1000UL;
static const unsigned long WIFI_REBOOT_AFTER_MS = 10UL * 60UL * 1000UL;
static const unsigned long MQTT_REBOOT_AFTER_MS = 10UL * 60UL * 1000UL;
static const unsigned long WIFI_HARD_RESET_COOLDOWN_MS = 2UL * 60UL * 1000UL;
static const uint32_t WATCHDOG_TIMEOUT_S = 30;

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

    // Software watchdog. Any hang in the main loop (TLS handshake, BLE wedge,
    // NVS write, etc.) longer than the timeout triggers a panic reset.
#if ESP_IDF_VERSION_MAJOR >= 5
    esp_task_wdt_config_t wdtConfig = {
        .timeout_ms = WATCHDOG_TIMEOUT_S * 1000,
        .idle_core_mask = 0,
        .trigger_panic = true,
    };
    esp_task_wdt_init(&wdtConfig);
#else
    esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);
#endif
    esp_task_wdt_add(NULL);

    // Hardware Setup
    pinMode(PIN_RELAY_IRRIGATION, OUTPUT);
    pinMode(PIN_SENSOR_WATER, INPUT_PULLUP);

    digitalWrite(PIN_RELAY_IRRIGATION, LOW);

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

    // Start the offline-too-long clocks running from boot, so a device that
    // never manages to connect after power-on still escalates to hard-reset.
    wifiDisconnectedSinceMs = millis();
    if (wifiDisconnectedSinceMs == 0)
        wifiDisconnectedSinceMs = 1;
}

void OrtusSystem::loop()
{
    esp_task_wdt_reset();

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
    unsigned long now = millis();

    if (status == WL_CONNECTED)
    {
        if (!wifiConnected)
        {
            wifiConnected = true;
            wifiDisconnectedSinceMs = 0;
            lastWifiHardResetMs = 0;
            Serial.println("[WiFi] Connected! IP: " + WiFi.localIP().toString());
            Serial.println("[WiFi] RSSI: " + String(WiFi.RSSI()) + " dBm");
            configTime(0, 0, "pool.ntp.org", "time.google.com");
            ble.updateWiFiState(true);
            publishPresence();
            publishLog("info", "WiFi", "connected ip=" + WiFi.localIP().toString() + " rssi=" + String(WiFi.RSSI()));
        }
        return;
    }

    if (wifiConnected)
    {
        wifiConnected = false;
        timeSynced = false;
        wifiDisconnectedSinceMs = now ? now : 1;
        mqttDisconnectedSinceMs = 0; // restart MQTT clock once WiFi returns
        ble.updateWiFiState(false);
        // Won't reach the broker (we're offline), but harmless if it does.
        publishLog("warn", "WiFi", "disconnected status=" + String(status));
    }

    if (wifiSSID.isEmpty())
        return;

    // --- Stale-connection escalation ---
    // After a sustained outage, plain WiFi.begin() retries are often useless:
    // the WiFi driver keeps targeting a cached BSSID/channel in ESP-IDF NVS
    // that may no longer exist (AP rebooted, channel changed, mesh failover).
    // This survives a power cycle. So if we've been offline a while, wipe the
    // ESP-IDF WiFi config the same way the BLE re-provisioning flow does, and
    // if that still doesn't help within the reboot window, hard-reset.
    if (wifiDisconnectedSinceMs > 0)
    {
        unsigned long offlineFor = now - wifiDisconnectedSinceMs;

        if (offlineFor > WIFI_REBOOT_AFTER_MS)
        {
            Serial.println("[WiFi] Offline > reboot threshold. Restarting.");
            // Best-effort log before reboot — won't reach broker (WiFi is down).
            publishLog("error", "WiFi", "offline > reboot threshold, restarting");
            delay(100);
            ESP.restart();
        }

        if (offlineFor > WIFI_HARD_RESET_AFTER_MS &&
            (lastWifiHardResetMs == 0 || now - lastWifiHardResetMs > WIFI_HARD_RESET_COOLDOWN_MS))
        {
            Serial.println("[WiFi] Offline > hard-reset threshold. Wiping cached AP config.");
            WiFi.disconnect(true);
            WiFi.mode(WIFI_OFF);
            delay(100);
            WiFi.mode(WIFI_STA);
            WiFi.setAutoReconnect(true);
            lastWifiHardResetMs = now;
            lastWifiAttempt = 0; // force a fresh WiFi.begin() below
            // Will be delivered if we recover — useful breadcrumb in logs.
            publishLog("warn", "WiFi", "wiped cached AP config after " + String(offlineFor / 1000) + "s offline");
        }
    }

    // Only call WiFi.begin() on definitive failure or first attempt.
    // Calling it while a connection is in progress resets the attempt.
    bool shouldRetry = false;

    if (status == WL_NO_SSID_AVAIL || status == WL_CONNECT_FAILED || status == WL_CONNECTION_LOST)
        shouldRetry = true;
    else if (status == WL_DISCONNECTED && now - lastWifiAttempt > 30000)
        shouldRetry = true; // stuck in disconnected state too long
    else if (lastWifiAttempt == 0)
        shouldRetry = true; // first attempt, or just did a hard reset

    if (shouldRetry)
    {
        lastWifiAttempt = now;
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
            publishLog("info", "Schedule", "light recovered");
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
            publishLog("info", "Schedule", "irrigation recovered");
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
    unsigned long now = millis();

    if (mqttClient.connected())
    {
        mqttDisconnectedSinceMs = 0;
        return;
    }

    // Start (or continue) the MQTT-offline clock, but only while WiFi is up —
    // otherwise this would double-count with the WiFi escalator above.
    if (mqttDisconnectedSinceMs == 0)
        mqttDisconnectedSinceMs = now ? now : 1;

    if (now - mqttDisconnectedSinceMs > MQTT_REBOOT_AFTER_MS)
    {
        Serial.println("[MQTT] WiFi up but broker unreachable > reboot threshold. Restarting.");
        // Can't log to MQTT — that's the thing that's broken. Serial only.
        delay(100);
        ESP.restart();
    }

    static unsigned long lastMqttAttempt = 0;
    if (now - lastMqttAttempt < 5000)
        return;
    lastMqttAttempt = now;

    Serial.print("[MQTT] Connecting...");
    String clientId = "Ortus-" + macAddress;
    String lwtTopic = "ortus/" + macAddress + "/status";

    if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD, lwtTopic.c_str(), 1, true, "offline"))
    {
        Serial.println("Connected");
        mqttDisconnectedSinceMs = 0;
        mqttClient.publish(lwtTopic.c_str(), "online", true);
        String cmdTopic = "ortus/" + macAddress + "/command";
        mqttClient.subscribe(cmdTopic.c_str());
        broadcastState(true);
        publishLog("info", "MQTT", "connected");
        if (!bootLogged)
        {
            bootLogged = true;
            publishLog("info", "Boot", "online reset_reason=" + String((int)esp_reset_reason()));
        }
    }
    else
    {
        int rc = mqttClient.state();
        Serial.print("Failed, rc=");
        Serial.println(rc);
        // Can't reach the broker — log won't be delivered. Recorded on next
        // successful reconnect via the "connected" message, which is enough
        // to spot a flapping device in the dashboard.
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
    else if (type == "setLightSchedule" || type == "setIrrigationSchedule")
    {
        if (type == "setLightSchedule")
            cmd.type = CommandType::SetLightSchedule;
        else
            cmd.type = CommandType::SetIrrigationSchedule;

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
        // SEN0485 with INPUT_PULLUP: LOW = liquid present, HIGH = empty.
        // Empty transitions immediately; "present" requires a stable window
        // to avoid false-positives from droplets/splashes.
        bool rawPresent = (digitalRead(PIN_SENSOR_WATER) == LOW);
        if (rawPresent)
        {
            if (waterPresentSince == 0)
                waterPresentSince = now;
            if (now - waterPresentSince > WATER_SENSITIVITY_MS && currentState.waterEmpty)
            {
                currentState.waterEmpty = false;
                broadcastState();
            }
        }
        else
        {
            waterPresentSince = 0;
            if (!currentState.waterEmpty)
            {
                currentState.waterEmpty = true;
                broadcastState();
            }
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
    doc["lightScheduleOnSeconds"] = currentState.lightScheduleOnSeconds;
    doc["lightScheduleOffSeconds"] = currentState.lightScheduleOffSeconds;
    doc["lightScheduleStartEpoch"] = currentState.lightScheduleStartEpoch;
    doc["irrigationOn"] = currentState.irrigationOn;
    doc["irrigationScheduleActive"] = currentState.irrigationScheduleActive;
    doc["irrigationScheduleOnSeconds"] = currentState.irrigationScheduleOnSeconds;
    doc["irrigationScheduleOffSeconds"] = currentState.irrigationScheduleOffSeconds;
    doc["irrigationScheduleStartEpoch"] = currentState.irrigationScheduleStartEpoch;
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

void OrtusSystem::publishLog(const char *level, const char *tag, const String &message)
{
    // Best-effort: logs are only delivered while MQTT is connected. The most
    // useful events (reconnect, schedule recovery) fire after connection comes
    // back, which is exactly when we want them.
    if (!mqttClient.connected())
        return;

    JsonDocument doc;
    doc["level"] = level;
    doc["tag"] = tag;
    doc["message"] = message;

    String json;
    serializeJson(doc, json);
    String topic = "ortus/" + macAddress + "/log";
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
    publishLog("info", "OTA", "starting from " + url);

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
    publishLog("error", "OTA", "failed: " + error);
    if (mqttClient.connected())
        mqttClient.publish(("ortus/" + macAddress + "/ota").c_str(), ("failed: " + error).c_str());
}
