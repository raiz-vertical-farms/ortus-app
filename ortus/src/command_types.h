#pragma once

#include <Arduino.h>

enum class CommandType
{
  SetBrightness
};

struct DeviceState
{
  int brightness = 0;
};

struct DeviceCommand
{
  CommandType type = CommandType::SetBrightness;
  int brightness = 0;
};

inline bool operator==(const DeviceState &lhs, const DeviceState &rhs)
{
  return lhs.brightness == rhs.brightness;
}

inline bool operator!=(const DeviceState &lhs, const DeviceState &rhs)
{
  return !(lhs == rhs);
}
