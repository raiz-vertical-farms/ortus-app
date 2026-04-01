#pragma once

#include <Arduino.h>
#include <math.h>

enum class CommandType
{
  SetBrightness,
  SetLightSchedule,
  SetIrrigationSchedule,
  SetFanSchedule,
  OtaUpdate
};

struct DeviceState
{
  int brightness = 0;

  // Irrigation cycle
  bool irrigationCycleActive = false;
  unsigned long irrigationCycleOnSeconds = 0;
  unsigned long irrigationCycleOffSeconds = 0;
  bool irrigationActive = false;

  // Light cycle
  bool lightCycleActive = false;
  unsigned long lightCycleOnSeconds = 0;
  unsigned long lightCycleOffSeconds = 0;

  // Fan cycle
  bool fanCycleActive = false;
  unsigned long fanCycleOnSeconds = 0;
  unsigned long fanCycleOffSeconds = 0;
  bool fanActive = false;

  float temperatureC = NAN;
  bool waterEmpty = false;
};

struct DeviceCommand
{
  CommandType type = CommandType::SetBrightness;
  int brightness = 0;

  // Shared interval schedule fields
  bool scheduleActive = false;
  unsigned long cycleOnSeconds = 0;
  unsigned long cycleOffSeconds = 0;
  bool startOff = false;

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
         lhs.lightCycleActive == rhs.lightCycleActive &&
         lhs.lightCycleOnSeconds == rhs.lightCycleOnSeconds &&
         lhs.lightCycleOffSeconds == rhs.lightCycleOffSeconds &&
         lhs.fanCycleActive == rhs.fanCycleActive &&
         lhs.fanCycleOnSeconds == rhs.fanCycleOnSeconds &&
         lhs.fanCycleOffSeconds == rhs.fanCycleOffSeconds &&
         lhs.fanActive == rhs.fanActive &&
         lhs.waterEmpty == rhs.waterEmpty &&
         tempsEqual;
}

inline bool operator!=(const DeviceState &lhs, const DeviceState &rhs)
{
  return !(lhs == rhs);
}
