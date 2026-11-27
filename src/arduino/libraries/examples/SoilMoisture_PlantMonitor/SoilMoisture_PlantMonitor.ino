// Plant watering monitor — YL-69 probe + YL-38 board
// Wiring: VCC -> 5V, GND -> GND, AO -> D4, DO -> D5
const int SOIL_AO = 4;
const int SOIL_DO = 5;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(SOIL_AO);                 // ~1023 dry ... ~250 soaked
  int moisture = map(raw, 1023, 250, 0, 100);
  moisture = constrain(moisture, 0, 100);
  Serial.print("Moisture: ");
  Serial.print(moisture);
  Serial.println("%");
  if (digitalRead(SOIL_DO) == HIGH) Serial.println("Soil is dry - water the plant");
  delay(1000);
}
