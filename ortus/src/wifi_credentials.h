#pragma once

#include <Arduino.h>
#include <Preferences.h>

class WiFiCredentialsStore
{
public:
  WiFiCredentialsStore();

  void begin();

  bool hasCredentials() const;
  String getSsid() const;
  String getPassword() const;

  void save(const String &ssid, const String &password);
  void clear();

private:
  void load();

  mutable Preferences preferences;
  bool started;
  String ssid;
  String password;
};

