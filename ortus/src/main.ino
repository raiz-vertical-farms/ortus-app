#include "network_manager.h"
#include "wifi_credentials.h"
#include "ble_provisioning.h"

WiFiCredentialsStore credentialsStore;
NetworkManager networkManager(credentialsStore);
BluetoothProvisioning *bleProvisioning = nullptr;

void setup()
{
  Serial.begin(115200);
  unsigned long waitStart = millis();
  while (!Serial && millis() - waitStart < 2000)
  {
    delay(10);
  }

  Serial.println();
  Serial.println(F("[Boot] Ortus firmware starting"));
  Serial.print(F("[Boot] Compiled on: "));
  Serial.print(F(__DATE__ " " __TIME__));
  Serial.println();
  Serial.printf("[Boot] Free heap: %u bytes\n", ESP.getFreeHeap());

  credentialsStore.begin();
  networkManager.begin();

  // Create BLE provisioning instance
  bleProvisioning = new BluetoothProvisioning(credentialsStore, networkManager);

  // Start BLE provisioning if no credentials stored
  if (!credentialsStore.hasCredentials())
  {
    Serial.println(F("[Boot] No WiFi credentials found, starting BLE provisioning"));
    bleProvisioning->begin();
  }
  else
  {
    // Try WiFi with existing credentials
    Serial.println(F("[Boot] Attempting WiFi connection with stored credentials"));
    unsigned long wifiStart = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 10000)
    {
      delay(500);
      Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() != WL_CONNECTED)
    {
      Serial.println(F("[Boot] WiFi connection failed, starting BLE provisioning"));
      bleProvisioning->begin();
    }
  }
}

void loop()
{
  networkManager.loop();

  if (bleProvisioning->isActive())
  {
    bleProvisioning->checkAutoStop();

    // Optional: stop BLE after WiFi connects
    if (WiFi.status() == WL_CONNECTED)
    {
      static unsigned long wifiConnectedTime = 0;
      if (wifiConnectedTime == 0)
      {
        wifiConnectedTime = millis();
      }
      if (millis() - wifiConnectedTime > 30000)
      {
        Serial.println(F("[Main] Stopping BLE after successful WiFi connection"));
        bleProvisioning->stop();
        wifiConnectedTime = 0;
      }
    }
  }
}
