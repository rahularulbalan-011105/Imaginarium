// Barometer + altimeter — BMP280 (Adafruit_BMP280 library)
// Wiring: VCC -> 5V, GND -> GND, SCL -> SCL (A5), SDA -> SDA (A4)
// The purple GY-BMP280 board answers at 0x76 (wire SDO -> VCC for 0x77).
#include <Wire.h>
#include <Adafruit_BMP280.h>

Adafruit_BMP280 bmp;

void setup() {
  Serial.begin(9600);
  if (!bmp.begin(0x76)) {
    Serial.println("Could not find a valid BMP280 sensor, check wiring!");
    while (1) delay(10);
  }
}

void loop() {
  Serial.print("Temperature = ");
  Serial.print(bmp.readTemperature());
  Serial.println(" C");

  Serial.print("Pressure = ");
  Serial.print(bmp.readPressure() / 100.0);
  Serial.println(" hPa");

  Serial.print("Approx altitude = ");
  Serial.print(bmp.readAltitude(1013.25));
  Serial.println(" m");

  Serial.println();
  delay(2000);
}
