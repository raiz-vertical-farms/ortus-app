#include "wifi_credentials.h"

#include <Arduino.h>

WiFiCredentialsStore::WiFiCredentialsStore() : started(false) {}

void WiFiCredentialsStore::begin()
{
  if (started)
  {
    return;
  }

  if (!preferences.begin("wifi", false))
  {
    Serial.println("[WiFiCredentials] Failed to open preferences namespace");
    return;
  }

  started = true;
  Serial.println(F("[WiFiCred] Preferences opened"));
  load();
  Serial.printf("[WiFiCred] Loaded SSID: %s\n", ssid.length() > 0 ? ssid.c_str() : "<none>");
}

bool WiFiCredentialsStore::hasCredentials() const
{
  return started && ssid.length() > 0;
}

String WiFiCredentialsStore::getSsid() const
{
  return ssid;
}

String WiFiCredentialsStore::getPassword() const
{
  return password;
}

void WiFiCredentialsStore::save(const String &newSsid, const String &newPassword)
{
  if (!started && !preferences.begin("wifi", false))
  {
    Serial.println("[WiFiCredentials] Failed to open preferences for saving");
    return;
  }

  started = true;

  preferences.putString("ssid", newSsid);
  preferences.putString("password", newPassword);

  ssid = newSsid;
  password = newPassword;
  Serial.printf("[WiFiCred] Saved SSID: %s (password length %u)\n", ssid.c_str(), password.length());
}

void WiFiCredentialsStore::clear()
{
  if (!started && !preferences.begin("wifi", false))
  {
    return;
  }

  started = true;

  preferences.remove("ssid");
  preferences.remove("password");

  ssid = "";
  password = "";
  Serial.println(F("[WiFiCred] Cleared stored credentials"));
}

void WiFiCredentialsStore::load()
{
  ssid = preferences.getString("ssid", "");
  password = preferences.getString("password", "");
  Serial.println(F("[WiFiCred] Credentials loaded from NVS"));
}
