#include "device_state_store.h"
#include <Arduino.h>

namespace
{
  constexpr const char *kNamespace = "dev_state";
}

DeviceStateStore::DeviceStateStore()
    : started(false),
      hasPersistedState(false)
{
}

void DeviceStateStore::begin()
{
  ensureStarted("begin");
}

bool DeviceStateStore::load(DeviceState &outState)
{
  if (!ensureStarted("load"))
  {
    return false;
  }

  const bool initialized = preferences.getBool("initialized", false);
  if (!initialized)
  {
    Serial.println(F("[StateStore] No persisted state found"));
    return false;
  }

  DeviceState loaded;
  loaded.brightness = preferences.getInt("brightness", outState.brightness);

  outState = loaded;
  lastPersistedState = loaded;
  hasPersistedState = true;

  Serial.println(F("[StateStore] Loaded device state from NVS"));
  return true;
}

bool DeviceStateStore::save(const DeviceState &state)
{
  if (!ensureStarted("save"))
  {
    return false;
  }

  if (hasPersistedState && state == lastPersistedState)
  {
    return false;
  }

  preferences.putInt("brightness", state.brightness);

  lastPersistedState = state;
  hasPersistedState = true;

  Serial.println(F("[StateStore] State saved to NVS"));
  return true;
}

bool DeviceStateStore::ensureStarted(const char *context)
{
  if (started)
  {
    return true;
  }

  if (!preferences.begin(kNamespace, false))
  {
    Serial.print(F("[StateStore] Failed to open preferences during "));
    Serial.println(context ? context : "unknown");
    return false;
  }

  started = true;
  return true;
}
