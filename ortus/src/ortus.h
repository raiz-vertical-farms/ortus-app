#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <WebSocketsServer.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#include <HTTPUpdate.h>

#include "config.h"
#include "types.h"
#include "ble_provisioning.h"

class OrtusSystem
{
public:
    OrtusSystem();

    void begin();
    void loop();

private:
    // --- Subsystems ---
    void setupWiFi();
    void connectWiFi();
    void setupMQTT();
    void connectMQTT();
    void setupSensors();
    void setupActuators();
    
    // --- Logic ---
    void handleCommand(const DeviceCommand &cmd);
    void updateSensors();
    void updateActuators();
    void broadcastState(bool force = false);
    void publishPresence();
    
    // --- State & Storage ---
    void loadState();
    void saveState();
    void loadCredentials();
    void saveCredentials(String ssid, String pass);
    void processRawCommand(const uint8_t *payload, size_t length);
    void performOtaUpdate(const String &url);

    // --- Callbacks ---
    static void mqttCallback(char *topic, uint8_t *payload, unsigned int length);
    static void webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length);
    void onMqttMessage(char *topic, uint8_t *payload, unsigned int length);
    void onWebSocketMessage(uint8_t num, WStype_t type, uint8_t *payload, size_t length);

    // --- Members ---
    WiFiClientSecure wifiClient;
    PubSubClient mqttClient;
    WebSocketsServer wsServer;
    Preferences preferences;
    OneWire oneWire;
    DallasTemperature sensors;
    BluetoothProvisioning ble;

    String wifiSSID;
    String wifiPass;
    String macAddress;

    DeviceState currentState;
    DeviceState lastBroadcastState;
    
    unsigned long lastWifiAttempt = 0;
    unsigned long lastPresence = 0;
    unsigned long lastTempPoll = 0;
    unsigned long lastWaterPoll = 0;
    unsigned long irrigationStopAt = 0;
    unsigned long irrigationCycleNextToggle = 0;
    bool irrigationCycleIsOnPhase = false;

    int appliedBrightness = -1;
    bool wifiConnected = false;
    
    static OrtusSystem* instance;
};
