#include "improv_manager.h"
#include "network_manager.h"
#include "wifi_credentials.h"

WiFiCredentialsStore credentialsStore;
ImprovManager improvManager(credentialsStore);
NetworkManager networkManager(credentialsStore);

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
  improvManager.begin();
  networkManager.begin();
}

void loop()
{
  improvManager.loop();
  networkManager.loop();
}
