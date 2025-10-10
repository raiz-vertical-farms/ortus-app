#include "websocket_command_adapter.h"

#include <ArduinoJson.h>
#include <WiFi.h>

WebSocketCommandAdapter *WebSocketCommandAdapter::instance = nullptr;

WebSocketCommandAdapter::WebSocketCommandAdapter(uint16_t port)
    : server(port),
      serverPort(port),
      hasBroadcastState(false)
{
}

void WebSocketCommandAdapter::begin()
{
  instance = this;
  server.begin();
  server.onEvent(WebSocketCommandAdapter::handleEventRouter);
  Serial.print(F("[WS] WebSocket server listening on port "));
  Serial.println(serverPort);
}

void WebSocketCommandAdapter::loop()
{
  server.loop();
}

void WebSocketCommandAdapter::notifyState(const DeviceState &state)
{
  lastBroadcastState = state;
  hasBroadcastState = true;
  broadcastState(state);
}

void WebSocketCommandAdapter::handleEventRouter(uint8_t clientNum, WStype_t type, uint8_t *payload, size_t length)
{
  if (instance != nullptr)
  {
    instance->handleEvent(clientNum, type, payload, length);
  }
}

void WebSocketCommandAdapter::handleEvent(uint8_t clientNum, WStype_t type, uint8_t *payload, size_t length)
{
  switch (type)
  {
  case WStype_CONNECTED:
  {
    const IPAddress ip = server.remoteIP(clientNum);
    Serial.print(F("[WS] Client connected: "));
    Serial.println(ip.toString());
    if (hasBroadcastState)
    {
      broadcastState(lastBroadcastState);
    }
    break;
  }
  case WStype_DISCONNECTED:
  {
    Serial.print(F("[WS] Client disconnected (#"));
    Serial.print(clientNum);
    Serial.println(F(")"));
    break;
  }
  case WStype_TEXT:
  {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);
    if (error)
    {
      Serial.print(F("[WS] Failed to parse message: "));
      Serial.println(error.c_str());
      return;
    }

    const char *typeField = doc["type"];
    if (!typeField)
    {
      Serial.println(F("[WS] Invalid command: missing type"));
      return;
    }

    String typeValue = String(typeField);
    typeValue.toLowerCase();

    if (typeValue == "setbrightness")
    {
      const int brightness = doc["brightness"].as<int>();
      if (brightness < 0 || brightness > 100)
      {
        Serial.println(F("[WS] Ignored invalid brightness command"));
        return;
      }

      DeviceCommand command;
      command.type = CommandType::SetBrightness;
      command.brightness = brightness;
      dispatchCommand(command);
    }
    else if (typeValue == "schedulelights")
    {
      LightSchedule schedule;
      JsonVariant scheduleVariant = doc["schedule"];
      if (scheduleVariant.is<JsonObject>())
      {
        JsonObject scheduleObj = scheduleVariant.as<JsonObject>();
        schedule.fromHour = scheduleObj["from_hour"].as<int>();
        schedule.fromMinute = scheduleObj["from_minute"].as<int>();
        schedule.toHour = scheduleObj["to_hour"].as<int>();
        schedule.toMinute = scheduleObj["to_minute"].as<int>();
        if (scheduleObj["enabled"].is<bool>())
        {
          schedule.enabled = scheduleObj["enabled"].as<bool>();
        }
        else
        {
          schedule.enabled = true;
        }
      }
      else
      {
        schedule.fromHour = doc["from_hour"].as<int>();
        schedule.fromMinute = doc["from_minute"].as<int>();
        schedule.toHour = doc["to_hour"].as<int>();
        schedule.toMinute = doc["to_minute"].as<int>();
        if (doc["enabled"].is<bool>())
        {
          schedule.enabled = doc["enabled"].as<bool>();
        }
        else
        {
          schedule.enabled = true;
        }
      }

      if (!schedule.isValid())
      {
        Serial.println(F("[WS] Ignored invalid schedule command"));
        return;
      }

      DeviceCommand command;
      command.type = CommandType::ScheduleLights;
      command.schedule = schedule;
      dispatchCommand(command);
    }
    else
    {
      Serial.print(F("[WS] Unknown command type: "));
      Serial.println(typeValue);
    }

    break;
  }
  default:
    break;
  }
}

void WebSocketCommandAdapter::broadcastState(const DeviceState &state)
{
  JsonDocument doc;
  JsonObject root = doc.to<JsonObject>();
  root["type"] = "state";
  root["brightness"] = state.brightness;

  JsonObject scheduleObj = root["schedule"].to<JsonObject>();
  scheduleObj["enabled"] = state.hasSchedule && state.schedule.enabled;
  scheduleObj["from_hour"] = state.schedule.fromHour;
  scheduleObj["from_minute"] = state.schedule.fromMinute;
  scheduleObj["to_hour"] = state.schedule.toHour;
  scheduleObj["to_minute"] = state.schedule.toMinute;

  String payload;
  serializeJson(doc, payload);

  server.broadcastTXT(payload);
}
