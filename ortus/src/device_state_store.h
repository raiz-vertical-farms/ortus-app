#pragma once

#include <Preferences.h>

#include "command_types.h"

class DeviceStateStore
{
public:
  DeviceStateStore();

  void begin();
  bool load(DeviceState &outState);
  bool save(const DeviceState &state);

private:
  bool ensureStarted(const char *context);

  Preferences preferences;
  bool started;
  bool hasPersistedState;
  DeviceState lastPersistedState;
};

