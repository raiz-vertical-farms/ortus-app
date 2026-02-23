# 1 "/var/folders/pj/3_1tpvl51blf8k97dv481t9w0000gn/T/tmpysecuz6r"
#include <Arduino.h>
# 1 "/Users/leifriksheim/apps/raiz-app/ortus/src/main.ino"
#include <Arduino.h>
#include "ortus.h"

OrtusSystem ortus;
void setup();
void loop();
#line 6 "/Users/leifriksheim/apps/raiz-app/ortus/src/main.ino"
void setup()
{
  ortus.begin();
}

void loop()
{
  ortus.loop();
}