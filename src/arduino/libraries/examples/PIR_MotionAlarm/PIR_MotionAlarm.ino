// PIR motion alarm — HC-SR501
// Wiring: PIR VCC -> 5V, GND -> GND, OUT -> D2 · LED + -> D9 (− -> GND)
const int PIR_PIN = 2;
const int LED_PIN = 9;

void setup() {
  Serial.begin(9600);
  pinMode(PIR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  if (digitalRead(PIR_PIN) == HIGH) {     // HIGH while motion is seen
    digitalWrite(LED_PIN, HIGH);
    Serial.println("Motion detected!");
  } else {
    digitalWrite(LED_PIN, LOW);
  }
  delay(200);
}
