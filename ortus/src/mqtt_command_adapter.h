#pragma once

#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include "command_adapter.h"

class MqttCommandAdapter : public CommandAdapter
{
public:
  MqttCommandAdapter(WiFiClientSecure &secureClient, PubSubClient &client);

  void setCredentials(const char *host, uint16_t port, const char *username, const char *password);
  void setIdentity(const String &mac);
  void begin() override;
  void loop() override;
  void notifyState(const DeviceState &state) override;
  void publishPresence(const String &payload);
  bool isConnected() const;
  void publishBrightnessState(int brightness);
  void publishPumpState(bool active);
  void publishTemperatureState(float temperatureC);
  void publishWaterLevelState(int level);

private:
  static void handleMessageRouter(char *topic, uint8_t *payload, unsigned int length);
  void handleMessage(char *topic, uint8_t *payload, unsigned int length);
  void ensureConnection();
  String getPresenceTopic() const;
  String getStatusTopic() const;
  String getCommandTopic() const;
  String getBrightnessStateTopic() const;
  String getPumpCommandTopic() const;
  String getPumpStateTopic() const;
  String getTemperatureStateTopic() const;
  String getWaterLevelStateTopic() const;

  static MqttCommandAdapter *instance;

  WiFiClientSecure &secureClient;
  PubSubClient &client;
  String macAddress;
  const char *host;
  uint16_t port;
  const char *username;
  const char *password;
};
