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
  if (!client.connected() || macAddress.isEmpty())
  {
    return;
  }

  const String stateTopic = getStateTopic();
  const String brightnessPayload = String(state.brightness);
  if (!client.publish(stateTopic.c_str(), brightnessPayload.c_str(), true))
  {
    Serial.println(F("[MQTT] Failed to publish brightness state"));
  }
  else
  {
    Serial.print(F("[MQTT] Brightness state → "));
    Serial.print(stateTopic);
    Serial.print(F(" = "));
    Serial.println(brightnessPayload);
  }

  const String scheduleTopic = getScheduleStateTopic();
  StaticJsonDocument<192> doc;
  doc["enabled"] = state.hasSchedule && state.schedule.enabled;
  doc["from_hour"] = state.schedule.fromHour;
  doc["from_minute"] = state.schedule.fromMinute;
  doc["to_hour"] = state.schedule.toHour;
  doc["to_minute"] = state.schedule.toMinute;

  String schedulePayload;
  serializeJson(doc, schedulePayload);

  if (!client.publish(scheduleTopic.c_str(), schedulePayload.c_str(), true))
  {
    Serial.println(F("[MQTT] Failed to publish schedule state"));
  }
  else
  {
    Serial.print(F("[MQTT] Schedule state → "));
    Serial.print(scheduleTopic);
    Serial.print(F(" = "));
    Serial.println(schedulePayload);
  }
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
  else if (topicStr == getScheduleCommandTopic())
  {
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, payload, length);
    if (error)
    {
      Serial.print(F("[MQTT] Failed to parse schedule payload: "));
      Serial.println(error.c_str());
      return;
    }

    LightSchedule schedule;
    schedule.fromHour = doc["from_hour"].as<int>();
    schedule.fromMinute = doc["from_minute"].as<int>();
    schedule.toHour = doc["to_hour"].as<int>();
    schedule.toMinute = doc["to_minute"].as<int>();
    schedule.enabled = true;

    if (!schedule.isValid())
    {
      Serial.println(F("[MQTT] Received invalid schedule command"));
      return;
    }

    DeviceCommand command;
    command.type = CommandType::ScheduleLights;
    command.schedule = schedule;
    dispatchCommand(command);
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
      client.subscribe(getScheduleCommandTopic().c_str());
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
  return macAddress + String("/sensor/light/command");
}

String MqttCommandAdapter::getStateTopic() const
{
  return macAddress + String("/sensor/light/state");
}

String MqttCommandAdapter::getScheduleCommandTopic() const
{
  return macAddress + String("/sensor/light/schedule/command");
}

String MqttCommandAdapter::getScheduleStateTopic() const
{
  return macAddress + String("/sensor/light/schedule/state");
}
