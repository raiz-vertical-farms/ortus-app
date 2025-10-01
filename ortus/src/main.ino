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
  bleProvisioning->begin();

  if (!credentialsStore.hasCredentials())
  {
    Serial.println(F("[Boot] No WiFi credentials found, waiting for provisioning"));
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
      Serial.println(F("[Boot] WiFi connection failed, continuing BLE provisioning"));
    }
  }
}

void loop()
{
  networkManager.loop();

  if (bleProvisioning->isActive())
  {
    bleProvisioning->checkAutoStop();
  }
}
