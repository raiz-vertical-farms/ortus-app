#include "mqtt_command_adapter.h"

#include <ArduinoJson.h>
#include <WiFi.h>
#include "config.h"

MqttCommandAdapter *MqttCommandAdapter::instance = nullptr;

MqttCommandAdapter::MqttCommandAdapter(WiFiClientSecure &secureClientRef, PubSubClient &clientRef)
    : secureClient(secureClientRef),
      client(clientRef),
      macAddress(""),
      host(nullptr),
      port(0),
      username(nullptr),
      password(nullptr)
{
}

void MqttCommandAdapter::setCredentials(const char *hostValue, uint16_t portValue, const char *usernameValue, const char *passwordValue)
{
  host = hostValue;
  port = portValue;
  username = usernameValue;
  password = passwordValue;
}

void MqttCommandAdapter::setIdentity(const String &mac)
{
  macAddress = mac;
}

void MqttCommandAdapter::begin()
{
  secureClient.setInsecure();
  client.setServer(host, port);
  instance = this;
  client.setCallback(MqttCommandAdapter::handleMessageRouter);
}

void MqttCommandAdapter::loop()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    return;
  }

  if (!client.connected())
  {
    ensureConnection();
  }

  client.loop();
}

void MqttCommandAdapter::notifyState(const DeviceState &state)
{
  publishBrightnessState(state.brightness);
  publishPumpState(state.pumpActive);
  publishFanState(state.fanActive);
  publishTemperatureState(state.temperatureC);
  publishWaterEmptyState(state.waterEmpty);
}

void MqttCommandAdapter::publishPresence(const String &payload)
{
  if (!client.connected() || macAddress.isEmpty())
  {
    return;
  }

  const String topic = getPresenceTopic();

  if (!client.publish(topic.c_str(), payload.c_str()))
  {
    Serial.println(F("[MQTT] Failed to publish presence"));
  }
  else
  {
    Serial.print(F("[MQTT] Presence heartbeat → "));
    Serial.print(topic);
    Serial.print(F(" = "));
    Serial.println(payload);
  }
}

bool MqttCommandAdapter::isConnected() const
{
  return client.connected();
}

void MqttCommandAdapter::publishBrightnessState(int brightness)
{
  if (!client.connected() || macAddress.isEmpty())
  {
    return;
  }

  const String topic = getBrightnessStateTopic();
  const String payload = String(brightness);
  if (!client.publish(topic.c_str(), payload.c_str(), true))
  {
    Serial.println(F("[MQTT] Failed to publish brightness state"));
  }
  else
  {
    Serial.print(F("[MQTT] Brightness state → "));
    Serial.print(topic);
    Serial.print(F(" = "));
    Serial.println(payload);
  }
}

void MqttCommandAdapter::publishPumpState(bool active)
{
  if (!client.connected() || macAddress.isEmpty())
  {
    return;
  }

  const String topic = getPumpStateTopic();
  const String payload = active ? String("1") : String("0");
  if (!client.publish(topic.c_str(), payload.c_str(), true))
  {
    Serial.println(F("[MQTT] Failed to publish pump state"));
  }
  else
  {
    Serial.print(F("[MQTT] Pump state → "));
    Serial.print(topic);
    Serial.print(F(" = "));
    Serial.println(payload);
  }
}

void MqttCommandAdapter::publishFanState(bool active)
{
  if (!client.connected() || macAddress.isEmpty())
  {
    return;
  }

  const String topic = getFanStateTopic();
  const String payload = active ? String("1") : String("0");
  if (!client.publish(topic.c_str(), payload.c_str(), true))
  {
    Serial.println(F("[MQTT] Failed to publish fan state"));
  }
  else
  {
    Serial.print(F("[MQTT] Fan state → "));
    Serial.print(topic);
    Serial.print(F(" = "));
    Serial.println(payload);
  }
}

void MqttCommandAdapter::publishTemperatureState(float temperatureC)
{
  if (!client.connected() || macAddress.isEmpty() || isnan(temperatureC))
  {
    return;
  }

  const String topic = getTemperatureStateTopic();
  const String payload = String(temperatureC, 2);
  if (!client.publish(topic.c_str(), payload.c_str(), true))
  {
    Serial.println(F("[MQTT] Failed to publish temperature"));
  }
  else
  {
    Serial.print(F("[MQTT] Temperature → "));
    Serial.print(topic);
    Serial.print(F(" = "));
    Serial.println(payload);
  }
}

void MqttCommandAdapter::publishWaterEmptyState(bool empty)
{
  if (!client.connected() || macAddress.isEmpty())
  {
    return;
  }

  const String topic = getWaterLevelStateTopic();
  const String payload = empty ? String("1") : String("0");
  if (!client.publish(topic.c_str(), payload.c_str(), true))
  {
    Serial.println(F("[MQTT] Failed to publish water level"));
  }
  else
  {
    Serial.print(F("[MQTT] Water level → "));
    Serial.print(topic);
    Serial.print(F(" = "));
    Serial.println(payload);
  }
}

void MqttCommandAdapter::handleMessageRouter(char *topic, uint8_t *payload, unsigned int length)
{
  if (instance != nullptr)
  {
    instance->handleMessage(topic, payload, length);
  }
}

void MqttCommandAdapter::handleMessage(char *topic, uint8_t *payload, unsigned int length)
{
  const String topicStr(topic);

  if (topicStr == getCommandTopic())
  {
    String message;
    message.reserve(length);
    for (unsigned int i = 0; i < length; i++)
    {
      message += static_cast<char>(payload[i]);
    }
    message.trim();

    const int value = message.toInt();
    if (value >= 0 && value <= 100)
    {
      DeviceCommand command;
      command.type = CommandType::SetBrightness;
      command.brightness = value;
      dispatchCommand(command);
    }
    else
    {
      Serial.print(F("[MQTT] Invalid brightness command: "));
      Serial.println(message);
    }
  }
  else if (topicStr == getPumpCommandTopic())
  {
    String message;
    message.reserve(length);
    for (unsigned int i = 0; i < length; i++)
    {
      message += static_cast<char>(payload[i]);
    }
    message.trim();

    const int durationSeconds = message.toInt();
    if (durationSeconds > 0)
    {
      DeviceCommand command;
      command.type = CommandType::TriggerPump;
      command.pumpDurationSeconds = durationSeconds;
      dispatchCommand(command);
    }
    else
    {
      Serial.print(F("[MQTT] Invalid pump command: "));
      Serial.println(message);
    }
  }
}

void MqttCommandAdapter::ensureConnection()
{
  if (macAddress.isEmpty())
  {
    return;
  }

  while (!client.connected())
  {
    Serial.print(F("[MQTT] Attempting connection..."));
    const String clientId = String("ESP32-") + macAddress;
    const String statusTopic = getStatusTopic();

    if (client.connect(clientId.c_str(), username, password, statusTopic.c_str(), 1, true, "offline"))
    {
      Serial.println(F("connected"));
      client.subscribe(getCommandTopic().c_str());
      client.subscribe(getPumpCommandTopic().c_str());
      client.publish(statusTopic.c_str(), "online", true);
    }
    else
    {
      Serial.print(F("failed, rc="));
      Serial.print(client.state());
      Serial.println(F(" retrying in 5 seconds"));
      delay(5000);
      if (WiFi.status() != WL_CONNECTED)
      {
        return;
      }
    }
  }
}

String MqttCommandAdapter::getPresenceTopic() const
{
  return macAddress + String("/presence");
}

String MqttCommandAdapter::getStatusTopic() const
{
  return macAddress + String("/status");
}

String MqttCommandAdapter::getCommandTopic() const
{
  return macAddress + String("/sensor/light/brightness/command");
}

String MqttCommandAdapter::getBrightnessStateTopic() const
{
  return macAddress + String("/sensor/light/brightness/state");
}

String MqttCommandAdapter::getPumpCommandTopic() const
{
  return macAddress + String("/sensor/pump/trigger/command");
}

String MqttCommandAdapter::getPumpStateTopic() const
{
  return macAddress + String("/sensor/pump/trigger/state");
}

String MqttCommandAdapter::getFanStateTopic() const
{
  return macAddress + String("/sensor/fan/state");
}

String MqttCommandAdapter::getTemperatureStateTopic() const
{
  return macAddress + String("/sensor/temperature/state");
}

String MqttCommandAdapter::getWaterLevelStateTopic() const
{
  return macAddress + String("/sensor/water/empty/state");
}
