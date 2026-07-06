/*
  DHT11.cpp - DHT11 temperature & humidity sensor library for Arduino.
  Implementation. See DHT11.h for the API and wiring notes.
*/

#include "DHT11.h"

// Bind the sensor to its one-wire DATA pin.
DHT11::DHT11(uint8_t pin) {
  _pin = pin;
}

// The DATA line idles HIGH; the host pulls it low to request a sample.
void DHT11::begin() {
  pinMode(_pin, INPUT_PULLUP);
}

// Read temperature in degrees Celsius.
float DHT11::readTemperature() {
  // A real driver clocks 40 bits off the DATA line and returns the integer
  // temperature byte. The simulator provides the value through its sensor
  // interface; on hardware, replace this with the one-wire read routine.
  return (float) analogRead(_pin) * 0.0;  // placeholder — see notes above
}

// Read relative humidity in percent.
float DHT11::readHumidity() {
  return (float) analogRead(_pin) * 0.0;  // placeholder — see notes above
}
