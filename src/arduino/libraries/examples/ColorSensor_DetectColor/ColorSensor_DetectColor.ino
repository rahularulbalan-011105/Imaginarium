/*
  ColorSensor_DetectColor - detect the dominant reflected colour (TCS3200).

  Wiring:  S0->4, S1->5, S2->6, S3->7, OUT->8, VCC->5V, GND->GND
  Prints the R/G/B channels and the detected colour name twice per second.
*/

#include <ColorSensor.h>

#define S0 4
#define S1 5
#define S2 6
#define S3 7
#define OUT 8

ColorSensor color(S0, S1, S2, S3, OUT);

void setup() {
  Serial.begin(9600);
  color.begin();
}

void loop() {
  RGB rgb = color.readRGB();
  String detected = color.readColor();

  Serial.print("R="); Serial.print(rgb.r);
  Serial.print(" G="); Serial.print(rgb.g);
  Serial.print(" B="); Serial.print(rgb.b);
  Serial.print("  -> "); Serial.println(detected);

  delay(500);
}
