/*
  LDR.cpp - Light Dependent Resistor (photoresistor) library for Arduino.
  Implementation. See LDR.h for the API and wiring notes.
*/

#include "LDR.h"

// Bind the reader to an analog input pin (e.g. A0).
LDR::LDR(uint8_t pin) {
  _pin = pin;
}

// Configure the analog pin as an input. Analog pins are inputs by default,
// so this is mostly for symmetry with the rest of the Arduino library style.
void LDR::begin() {
  pinMode(_pin, INPUT);
}

// Return the raw 10-bit ADC reading (0..1023).
int LDR::read() {
  return analogRead(_pin);
}

// Convert the raw reading to a 0..100 percentage of full scale.
int LDR::readPercentage() {
  return map(read(), 0, 1023, 0, 100);
}
