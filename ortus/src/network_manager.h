#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "command_adapter.h"
#include "command_types.h"
#include "mqtt_command_adapter.h"
#include "websocket_command_adapter.h"
#include "wifi_credentials.h"

class NetworkManager
{
public:
  explicit NetworkManager(WiFiCredentialsStore &credentialsStore);

  void connectWiFi();
  void begin();
  void loop();
  void forceReconnect();
  static NetworkManager *getInstance() { return instance_; }
  uint16_t websocketPort() const { return websocketAdapter.port(); }

private:
  void onWiFiConnected();
  void handleDeviceCommand(const DeviceCommand &command);
  void setBrightness(int value);
  void updateSchedule(const LightSchedule &schedule);
  void broadcastState();
  void publishPresence();
  String buildPresencePayload() const;
  void ensureAdapterIdentity();
  String getPublicIP();
  void applyBrightnessToPixels();

  WiFiCredentialsStore &credentials;
  WiFiClientSecure espClient;
  PubSubClient client;
  MqttCommandAdapter mqttAdapter;
  WebSocketCommandAdapter websocketAdapter;
  CommandAdapter *transports[2];
  size_t transportCount;
  String macAddress;
  unsigned long lastPresenceAt;
  unsigned long lastWiFiAttempt;
  unsigned long lastPublicIpFetch;
  DeviceState deviceState;
  bool wifiWasConnected;
  bool mqttWasConnected;
  bool waitingForCredentialsLogged;
  bool waitingBeforeRetryLogged;
  bool adaptersInitialized;
  String cachedPublicIp;

  static NetworkManager *instance_;
};
