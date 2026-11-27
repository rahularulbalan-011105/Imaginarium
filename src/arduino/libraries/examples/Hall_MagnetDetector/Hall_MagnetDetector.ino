// Magnet detector — A3144 Hall sensor (KY-003)
// Wiring: + -> 5V, - -> GND, S -> D8 · LED + -> D9 (− -> GND)
const int HALL_PIN = 8;
const int LED_PIN  = 9;

void setup() {
  Serial.begin(9600);
  pinMode(HALL_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  if (digitalRead(HALL_PIN) == LOW) {      // LOW = magnet near
    digitalWrite(LED_PIN, HIGH);
    Serial.println("Magnet detected");
  } else {
    digitalWrite(LED_PIN, LOW);
  }
  delay(100);
}
