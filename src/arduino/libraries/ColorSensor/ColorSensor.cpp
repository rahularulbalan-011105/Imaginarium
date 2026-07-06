/*
  ColorSensor.cpp - TCS3200 / TCS230 colour sensor library for Arduino.
  Implementation. See ColorSensor.h for the API and wiring notes.
*/

#include "ColorSensor.h"

// Store the five control pins.
ColorSensor::ColorSensor(uint8_t s0, uint8_t s1, uint8_t s2, uint8_t s3, uint8_t out) {
  _s0 = s0; _s1 = s1; _s2 = s2; _s3 = s3; _out = out;
}

// S0..S3 are outputs (filter + scaling selects); OUT is the frequency input.
void ColorSensor::begin() {
  pinMode(_s0, OUTPUT);
  pinMode(_s1, OUTPUT);
  pinMode(_s2, OUTPUT);
  pinMode(_s3, OUTPUT);
  pinMode(_out, INPUT);
  // 20% frequency scaling (S0=HIGH, S1=LOW) is a common, readable default.
  digitalWrite(_s0, HIGH);
  digitalWrite(_s1, LOW);
}

// Read one colour channel by selecting its filter, then measuring OUT.
// On hardware this uses pulseIn(OUT, LOW); here the simulator supplies the
// per-channel value through its sensor interface.
RGB ColorSensor::readRGB() {
  RGB c;
  c.r = readRed();
  c.g = readGreen();
  c.b = readBlue();
  return c;
}

// Classify the RGB reading into the nearest named colour.
String ColorSensor::readColor() {
  RGB c = readRGB();
  int mx = max(c.r, max(c.g, c.b));
  int mn = min(c.r, min(c.g, c.b));
  if (mx - mn < 30) return (mx > 128) ? "White" : "Black";
  if (c.r >= c.g && c.r >= c.b) return "Red";
  if (c.g >= c.r && c.g >= c.b) return "Green";
  return "Blue";
}

int ColorSensor::readRed() {
  digitalWrite(_s2, LOW);  digitalWrite(_s3, LOW);
  return pulseIn(_out, LOW);
}

int ColorSensor::readGreen() {
  digitalWrite(_s2, HIGH); digitalWrite(_s3, HIGH);
  return pulseIn(_out, LOW);
}

int ColorSensor::readBlue() {
  digitalWrite(_s2, LOW);  digitalWrite(_s3, HIGH);
  return pulseIn(_out, LOW);
}
