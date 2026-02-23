#pragma once

#include <Arduino.h>
#include <math.h>

enum class CommandType
{
  SetBrightness,
  TriggerIrrigation,
  IrrigationCycle,
  OtaUpdate
};

struct DeviceState
{
  int brightness = 0;
  bool irrigationActive = false;
  bool irrigationCycleActive = false;
  unsigned long irrigationCycleOnSeconds = 0;
  unsigned long irrigationCycleOffSeconds = 0;
  float temperatureC = NAN;
  bool waterEmpty = false;
};

struct DeviceCommand
{
  CommandType type = CommandType::SetBrightness;
  int brightness = 0;
  unsigned long irrigationDurationSeconds = 0;
  unsigned long irrigationCycleOnSeconds = 0;
  unsigned long irrigationCycleOffSeconds = 0;
  String otaUrl;
};

inline bool operator==(const DeviceState &lhs, const DeviceState &rhs)
{
  const bool tempsEqual = isnan(lhs.temperatureC) ? isnan(rhs.temperatureC) : fabs(lhs.temperatureC - rhs.temperatureC) < 0.01f;

  return lhs.brightness == rhs.brightness &&
         lhs.irrigationActive == rhs.irrigationActive &&
         lhs.irrigationCycleActive == rhs.irrigationCycleActive &&
         lhs.irrigationCycleOnSeconds == rhs.irrigationCycleOnSeconds &&
         lhs.irrigationCycleOffSeconds == rhs.irrigationCycleOffSeconds &&
         lhs.waterEmpty == rhs.waterEmpty &&
         tempsEqual;
}

inline bool operator!=(const DeviceState &lhs, const DeviceState &rhs)
{
  return !(lhs == rhs);
}
