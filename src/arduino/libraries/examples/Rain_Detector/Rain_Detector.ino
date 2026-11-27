// Rain detector — FC-37 rain plate
// Wiring: VCC -> 5V, GND -> GND, DO -> D5, AO -> D6
const int RAIN_DO = 5;
const int RAIN_AO = 6;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int wet = analogRead(RAIN_AO);                 // lower = wetter
  Serial.print("Rain AO: ");
  Serial.print(wet);
  if (digitalRead(RAIN_DO) == LOW) Serial.println("  -> raining");
  else Serial.println("  -> dry");
  delay(500);
}
