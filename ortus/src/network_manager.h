#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "command_adapter.h"
#include "command_types.h"
#include "device_state_store.h"
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
  void broadcastState(bool force = false);
  void publishPresence();
  String buildPresencePayload() const;
  void ensureAdapterIdentity();
  String getPublicIP();
  void applyBrightnessToRelays(int value);
  void configureTime();
  void evaluateSchedule(bool force = false);
  void applyScheduledOutput();
  bool shouldScheduleBeOn(int currentMinutes) const;

  WiFiCredentialsStore &credentials;
  WiFiClientSecure espClient;
  PubSubClient client;
  DeviceStateStore stateStore;
  MqttCommandAdapter mqttAdapter;
  WebSocketCommandAdapter websocketAdapter;
  CommandAdapter *transports[2];
  size_t transportCount;
  String macAddress;
  unsigned long lastPresenceAt;
  unsigned long lastWiFiAttempt;
  unsigned long lastPublicIpFetch;
  unsigned long lastScheduleEvaluation;
  DeviceState deviceState;
  DeviceState lastBroadcastState;
  bool wifiWasConnected;
  bool mqttWasConnected;
  bool waitingForCredentialsLogged;
  bool waitingBeforeRetryLogged;
  bool waitingForTimeSyncLogged;
  bool adaptersInitialized;
  bool hasBroadcastState;
  bool scheduleActive;
  int appliedBrightness;
  String cachedPublicIp;

  static NetworkManager *instance_;
};
