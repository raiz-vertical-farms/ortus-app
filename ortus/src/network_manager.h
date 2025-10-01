#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

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

private:
  static void mqttCallbackRouter(char *topic, uint8_t *payload, unsigned int length);

    void ensureMqttConnection();
  void publishPresence();
  void publishLightState();
  void handleMqttMessage(char *topic, uint8_t *payload, unsigned int length);
  void processLightCommand(const String &command);
  String getPresenceTopic() const;
  String getCommandTopic() const;
  String getStateTopic() const;
  String getPublicIP();

  WiFiCredentialsStore &credentials;
  WiFiClientSecure espClient;
  PubSubClient client;
  String macAddress;
  unsigned long lastPresenceAt;
  unsigned long lastWiFiAttempt;
  bool lightOn;
  bool wifiWasConnected;
  bool waitingForCredentialsLogged;
  bool waitingBeforeRetryLogged;

  static NetworkManager *instance_;
};
