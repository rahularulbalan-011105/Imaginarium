/*
  LDR.h - Light Dependent Resistor (photoresistor) library for Arduino.

  An LDR (photoresistor) changes resistance with light: bright light lowers its
  resistance, darkness raises it. Wired as a voltage divider, its analog output
  (AO) can be read on any analog pin to measure ambient light intensity.

  --------------------------------------------------------------------------
  Wiring (typical LDR breakout module):
      VCC  -> 5V
      GND  -> GND
      AO   -> an analog pin (e.g. A0)   // analog light level (0..1023)
      DO   -> a digital pin (optional)  // HIGH/LOW past an on-board threshold
  --------------------------------------------------------------------------

  Example:

      #include <LDR.h>

      LDR ldr(A0);

      void setup() {
        Serial.begin(9600);
        ldr.begin();
      }

      void loop() {
        int value      = ldr.read();            // 0 (dark) .. 1023 (bright)
        int percentage = ldr.readPercentage();  // 0 .. 100 %
        Serial.print("Light: ");
        Serial.print(value);
        Serial.print("  (");
        Serial.print(percentage);
        Serial.println("%)");
        delay(500);
      }

  Author:  Imaginarium 3D Design Editor
  License: MIT
*/

#ifndef LDR_H
#define LDR_H

#include <Arduino.h>

class LDR {
  public:
    // Construct an LDR reader bound to an analog input pin (e.g. A0).
    LDR(uint8_t pin);

    // Prepare the pin. Call once from setup().
    void begin();

    // Raw ambient-light reading, 0 (dark) .. 1023 (bright).
    int read();

    // Ambient light as a percentage of full scale, 0 .. 100.
    int readPercentage();

  private:
    uint8_t _pin;
};

#endif  // LDR_H
