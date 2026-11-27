// Touch lamp — TTP223 capacitive touch
// Wiring: VCC -> 5V, GND -> GND, I/O -> D7 · LED + -> D9 (− -> GND)
const int TOUCH_PIN = 7;
const int LED_PIN   = 9;
int last = LOW;
bool lampOn = false;

void setup() {
  Serial.begin(9600);
  pinMode(TOUCH_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int now = digitalRead(TOUCH_PIN);        // HIGH while touched
  if (now == HIGH && last == LOW) {        // a new touch
    lampOn = !lampOn;
    digitalWrite(LED_PIN, lampOn ? HIGH : LOW);
    Serial.println(lampOn ? "Lamp on" : "Lamp off");
  }
  last = now;
  delay(30);
}
