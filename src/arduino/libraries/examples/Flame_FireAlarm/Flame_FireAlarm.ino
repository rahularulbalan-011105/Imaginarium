// Flame alarm — IR flame module (LM393)
// Wiring: VCC -> 5V, GND -> GND, DO -> D3, AO -> D4 · Buzzer I/O -> D9
const int FLAME_DO = 3;
const int FLAME_AO = 4;
const int BUZZER   = 9;

void setup() {
  Serial.begin(9600);
  pinMode(FLAME_DO, INPUT);
}

void loop() {
  int strength = analogRead(FLAME_AO);    // lower = stronger flame
  Serial.print("Flame AO: ");
  Serial.println(strength);
  if (digitalRead(FLAME_DO) == LOW) {     // LOW = flame detected
    Serial.println("FIRE!");
    tone(BUZZER, 1000, 200);
  }
  delay(300);
}
