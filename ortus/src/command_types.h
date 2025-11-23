#pragma once

#include <Arduino.h>

enum class CommandType
{
  SetBrightness,
  TriggerPump
};

struct DeviceState
{
  int brightness = 0;
  bool pumpActive = false;
  float temperatureC = NAN;
  int waterLevel = -1;
};

struct DeviceCommand
{
  CommandType type = CommandType::SetBrightness;
  int brightness = 0;
  unsigned long pumpDurationSeconds = 0;
};

inline bool operator==(const DeviceState &lhs, const DeviceState &rhs)
{
  const bool tempsEqual = isnan(lhs.temperatureC) ? isnan(rhs.temperatureC) : fabs(lhs.temperatureC - rhs.temperatureC) < 0.01f;

  return lhs.brightness == rhs.brightness &&
         lhs.pumpActive == rhs.pumpActive &&
         lhs.waterLevel == rhs.waterLevel &&
         tempsEqual;
}

inline bool operator!=(const DeviceState &lhs, const DeviceState &rhs)
{
  return !(lhs == rhs);
}
