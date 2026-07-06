/*
  DHT11.h - DHT11 temperature & humidity sensor library for Arduino.

  The DHT11 is a low-cost digital sensor that reports ambient temperature
  (0-50 C, +/-2 C) and relative humidity (20-90 %RH, +/-5 %) over a single
  one-wire DATA line.

  --------------------------------------------------------------------------
  Wiring:
      VCC  -> 5V (or 3.3V)
      GND  -> GND
      DATA -> a digital pin (e.g. 2)
  --------------------------------------------------------------------------

  Example:

      #include <DHT11.h>

      DHT11 dht(2);

      void setup() {
        Serial.begin(9600);
        dht.begin();
      }

      void loop() {
        float temp = dht.readTemperature();  // degrees Celsius
        float hum  = dht.readHumidity();     // relative humidity %
        Serial.print("Temp: ");
        Serial.print(temp);
        Serial.print(" C   Humidity: ");
        Serial.print(hum);
        Serial.println(" %");
        delay(2000);   // the DHT11 samples about once per second
      }

  Author:  Imaginarium 3D Design Editor
  License: MIT
*/

#ifndef DHT11_H
#define DHT11_H

#include <Arduino.h>

class DHT11 {
  public:
    // Construct a DHT11 bound to its DATA pin (e.g. 2).
    DHT11(uint8_t pin);

    // Prepare the sensor. Call once from setup().
    void begin();

    // Latest temperature reading in degrees Celsius.
    float readTemperature();

    // Latest relative-humidity reading in percent.
    float readHumidity();

  private:
    uint8_t _pin;
};

#endif  // DHT11_H
