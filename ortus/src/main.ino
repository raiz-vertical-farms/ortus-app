#include <Arduino.h>
#include "ortus.h"

OrtusSystem ortus;

void setup()
{
  ortus.begin();
}

void loop()
{
  ortus.loop();
}
