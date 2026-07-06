/*
  ColorSensor.h - TCS3200 / TCS230 colour sensor library for Arduino.

  The TCS3200 shines white light on a surface and measures the reflected red,
  green and blue components as a frequency on its OUT pin. S2/S3 select the
  colour filter; S0/S1 scale the output frequency. This library wraps that into
  a simple readRGB() / readColor() API.

  --------------------------------------------------------------------------
  Wiring:
      VCC -> 5V
      GND -> GND
      S0  -> a digital pin      // output frequency scaling
      S1  -> a digital pin
      S2  -> a digital pin      // colour filter select
      S3  -> a digital pin
      OUT -> a digital pin      // frequency proportional to colour intensity
  --------------------------------------------------------------------------

  Example:

      #include <ColorSensor.h>

      // #define the pins (as most TCS3200 examples do) or pass numbers directly
      ColorSensor color(S0, S1, S2, S3, OUT);

      void setup() {
        Serial.begin(9600);
        color.begin();
      }

      void loop() {
        RGB rgb = color.readRGB();            // { r, g, b }, each 0..255
        String detected = color.readColor();  // "Red", "Green", "Blue", ...
        int r = color.readRed();
        int g = color.readGreen();
        int b = color.readBlue();

        Serial.print("R="); Serial.print(r);
        Serial.print(" G="); Serial.print(g);
        Serial.print(" B="); Serial.print(b);
        Serial.print("  -> "); Serial.println(detected);
        delay(500);
      }

  Author:  Imaginarium 3D Design Editor
  License: MIT
*/

#ifndef COLORSENSOR_H
#define COLORSENSOR_H

#include <Arduino.h>

// A single reflected-colour reading. Each channel is 0..255.
struct RGB {
  int r;
  int g;
  int b;
};

class ColorSensor {
  public:
    // Construct with the five control pins: S0, S1, S2, S3, OUT.
    ColorSensor(uint8_t s0, uint8_t s1, uint8_t s2, uint8_t s3, uint8_t out);

    // Configure the control pins. Call once from setup().
    void begin();

    // Read all three channels at once.
    RGB readRGB();

    // Classify the reading into a named colour ("Red", "Green", ...).
    String readColor();

    // Individual channels (0..255).
    int readRed();
    int readGreen();
    int readBlue();

  private:
    uint8_t _s0, _s1, _s2, _s3, _out;
};

#endif  // COLORSENSOR_H
