#pragma once

#include <Arduino.h>

enum class CommandType
{
  SetBrightness,
  ScheduleLights
};

struct LightSchedule
{
  int fromHour = 0;
  int fromMinute = 0;
  int toHour = 0;
  int toMinute = 0;
  bool enabled = false;

  bool isValid() const
  {
    const bool hoursValid = fromHour >= 0 && fromHour <= 23 && toHour >= 0 && toHour <= 23;
    const bool minutesValid = fromMinute >= 0 && fromMinute <= 59 && toMinute >= 0 && toMinute <= 59;
    return hoursValid && minutesValid;
  }
};

struct DeviceState
{
  int brightness = 0;
  bool hasSchedule = false;
  LightSchedule schedule;
};

struct DeviceCommand
{
  CommandType type = CommandType::SetBrightness;
  int brightness = 0;
  LightSchedule schedule;
};

inline bool operator==(const LightSchedule &lhs, const LightSchedule &rhs)
{
  return lhs.fromHour == rhs.fromHour &&
         lhs.fromMinute == rhs.fromMinute &&
         lhs.toHour == rhs.toHour &&
         lhs.toMinute == rhs.toMinute &&
         lhs.enabled == rhs.enabled;
}

inline bool operator!=(const LightSchedule &lhs, const LightSchedule &rhs)
{
  return !(lhs == rhs);
}

inline bool operator==(const DeviceState &lhs, const DeviceState &rhs)
{
  return lhs.brightness == rhs.brightness &&
         lhs.hasSchedule == rhs.hasSchedule &&
         lhs.schedule == rhs.schedule;
}

inline bool operator!=(const DeviceState &lhs, const DeviceState &rhs)
{
  return !(lhs == rhs);
}
