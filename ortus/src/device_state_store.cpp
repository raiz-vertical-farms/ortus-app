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
  loaded.hasSchedule = preferences.getBool("has_schedule", outState.hasSchedule);
  loaded.schedule.fromHour = preferences.getInt("from_hour", outState.schedule.fromHour);
  loaded.schedule.fromMinute = preferences.getInt("from_minute", outState.schedule.fromMinute);
  loaded.schedule.toHour = preferences.getInt("to_hour", outState.schedule.toHour);
  loaded.schedule.toMinute = preferences.getInt("to_minute", outState.schedule.toMinute);
  loaded.schedule.enabled = preferences.getBool("schedule_enabled", outState.schedule.enabled);

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
  preferences.putBool("has_schedule", state.hasSchedule);
  preferences.putInt("from_hour", state.schedule.fromHour);
  preferences.putInt("from_minute", state.schedule.fromMinute);
  preferences.putInt("to_hour", state.schedule.toHour);
  preferences.putInt("to_minute", state.schedule.toMinute);
  preferences.putBool("schedule_enabled", state.schedule.enabled);
  preferences.putBool("initialized", true);

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

