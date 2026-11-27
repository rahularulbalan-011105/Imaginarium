// Clap switch — KY-038 sound sensor
// Wiring: + -> 5V, G -> GND, DO -> D6 · LED + -> D9 (− -> GND)
const int SOUND_DO = 6;
const int LED_PIN  = 9;
bool lightOn = false;

void setup() {
  Serial.begin(9600);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  if (digitalRead(SOUND_DO) == HIGH) {     // HIGH on a loud sound
    lightOn = !lightOn;
    digitalWrite(LED_PIN, lightOn ? HIGH : LOW);
    Serial.println(lightOn ? "Clap: light ON" : "Clap: light OFF");
    delay(400);                            // ignore the echo of the same clap
  }
  delay(20);
}
