#pragma once

#include <Arduino.h>
#include <math.h>

enum class CommandType
{
  SetBrightness,
  TriggerIrrigation
};

struct DeviceState
{
  int brightness = 0;
  bool irrigationActive = false;
  float temperatureC = NAN;
  bool waterEmpty = false;
};

struct DeviceCommand
{
  CommandType type = CommandType::SetBrightness;
  int brightness = 0;
  unsigned long irrigationDurationSeconds = 0;
};

inline bool operator==(const DeviceState &lhs, const DeviceState &rhs)
{
  const bool tempsEqual = isnan(lhs.temperatureC) ? isnan(rhs.temperatureC) : fabs(lhs.temperatureC - rhs.temperatureC) < 0.01f;

  return lhs.brightness == rhs.brightness &&
         lhs.irrigationActive == rhs.irrigationActive &&
         lhs.waterEmpty == rhs.waterEmpty &&
         tempsEqual;
}

inline bool operator!=(const DeviceState &lhs, const DeviceState &rhs)
{
  return !(lhs == rhs);
}
