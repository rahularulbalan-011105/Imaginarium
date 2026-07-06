/*
  DHT11_ReadTempHumidity - read temperature & humidity with a DHT11.

  Wiring:  DHT11 VCC->5V, GND->GND, DATA->2
  Prints temperature (C) and relative humidity (%) every 2 seconds.
*/

#include <DHT11.h>

DHT11 dht(2);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();

  Serial.print("Temp: ");
  Serial.print(temp);
  Serial.print(" C   Humidity: ");
  Serial.print(hum);
  Serial.println(" %");

  delay(2000);
}
