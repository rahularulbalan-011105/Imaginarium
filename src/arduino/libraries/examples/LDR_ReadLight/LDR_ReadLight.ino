/*
  LDR_ReadLight - read ambient light with an LDR (photoresistor).

  Wiring:  LDR VCC->5V, GND->GND, AO->A0
  Prints the raw value (0..1023) and a 0..100% brightness once per second.
*/

#include <LDR.h>

LDR ldr(A0);

void setup() {
  Serial.begin(9600);
  ldr.begin();
}

void loop() {
  int value = ldr.read();
  int pct   = ldr.readPercentage();

  Serial.print("Light: ");
  Serial.print(value);
  Serial.print("  (");
  Serial.print(pct);
  Serial.println("%)");

  delay(1000);
}
