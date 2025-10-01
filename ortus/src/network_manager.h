#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

class NetworkManager
{
public:
  NetworkManager();

  void begin();
  void loop();

private:
  static void mqttCallbackRouter(char *topic, uint8_t *payload, unsigned int length);

  void connectWiFi();
  void ensureMqttConnection();
  void publishPresence();
  void publishLightState();
  void handleMqttMessage(char *topic, uint8_t *payload, unsigned int length);
  void processLightCommand(const String &command);
  String getPresenceTopic() const;
  String getCommandTopic() const;
  String getStateTopic() const;
  String getPublicIP();

  WiFiClientSecure espClient;
  PubSubClient client;
  String macAddress;
  unsigned long lastPresenceAt;
  bool lightOn;

  static NetworkManager *instance_;
};
