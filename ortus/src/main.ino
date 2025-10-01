#include "network_manager.h"

NetworkManager networkManager;

void setup()
{
  Serial.begin(115200);
  networkManager.begin();
}

void loop()
{
  networkManager.loop();
}

