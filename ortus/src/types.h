#pragma once

#include <Arduino.h>
#include <math.h>

enum class CommandType
{
  SetBrightness,
  SetLightSchedule,
  SetIrrigationSchedule,
  OtaUpdate
};

struct DeviceState
{
  int brightness = 0;

  // Light
  bool lightScheduleActive = false;
  unsigned long lightScheduleOnSeconds = 0;
  unsigned long lightScheduleOffSeconds = 0;
  unsigned long lightScheduleStartEpoch = 0;
  bool lightOn = false;

  // Irrigation (single relay drives pump + fan)
  bool irrigationScheduleActive = false;
  unsigned long irrigationScheduleOnSeconds = 0;
  unsigned long irrigationScheduleOffSeconds = 0;
  unsigned long irrigationScheduleStartEpoch = 0;
  bool irrigationOn = false;

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
  unsigned long start_at_epoch = 0;

  String otaUrl;
};

inline bool operator==(const DeviceState &lhs, const DeviceState &rhs)
{
  const bool tempsEqual = isnan(lhs.temperatureC) ? isnan(rhs.temperatureC) : fabs(lhs.temperatureC - rhs.temperatureC) < 0.01f;

  return lhs.brightness == rhs.brightness &&
         lhs.lightOn == rhs.lightOn &&
         lhs.lightScheduleActive == rhs.lightScheduleActive &&
         lhs.lightScheduleOnSeconds == rhs.lightScheduleOnSeconds &&
         lhs.lightScheduleOffSeconds == rhs.lightScheduleOffSeconds &&
         lhs.lightScheduleStartEpoch == rhs.lightScheduleStartEpoch &&
         lhs.irrigationOn == rhs.irrigationOn &&
         lhs.irrigationScheduleActive == rhs.irrigationScheduleActive &&
         lhs.irrigationScheduleOnSeconds == rhs.irrigationScheduleOnSeconds &&
         lhs.irrigationScheduleOffSeconds == rhs.irrigationScheduleOffSeconds &&
         lhs.irrigationScheduleStartEpoch == rhs.irrigationScheduleStartEpoch &&
         lhs.waterEmpty == rhs.waterEmpty &&
         tempsEqual;
}

inline bool operator!=(const DeviceState &lhs, const DeviceState &rhs)
{
  return !(lhs == rhs);
}
