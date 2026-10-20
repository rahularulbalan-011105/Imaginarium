// ─────────────────────────────────────────────────────────────────────────────
// ESP32 example sketches offered in the Code panel's Templates menu when an
// ESP32 board is in the scene.
//
// Every one of these runs in Constructa's simulated runtime. They are written
// the way real Arduino-ESP32 code is written (LEDC for PWM, 12-bit ADC, the
// WiFi/BluetoothSerial/BLE APIs), so copying a sketch into the Arduino IDE is a
// realistic starting point — but the radios here are SIMULATED, and a browser
// cannot compile or flash firmware. See docs/ESP32.md.
// ─────────────────────────────────────────────────────────────────────────────

export const ESP32_EXAMPLES = [
  {
    label: 'Blink (onboard LED)',
    code: `// ESP32 DevKit V1 — the onboard blue LED is on GPIO 2.
const int LED = 2;

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
  Serial.println("blink");
}
`,
  },
  {
    label: 'Digital input (pulldown)',
    code: `// A button to GPIO 4. ESP32 has internal pulldowns as well as pullups.
const int BTN = 4;
const int LED = 2;

void setup() {
  Serial.begin(115200);
  pinMode(BTN, INPUT_PULLDOWN);
  pinMode(LED, OUTPUT);
}

void loop() {
  int pressed = digitalRead(BTN);
  digitalWrite(LED, pressed);
  if (pressed) Serial.println("pressed");
  delay(50);
}
`,
  },
  {
    label: 'Analog read (12-bit ADC)',
    code: `// ESP32 ADC is 12-bit: analogRead() returns 0..4095 (not 0..1023).
// ADC1 pins (32-39) are safe with Wi-Fi; ADC2 pins are not.
// @control readout raw   label="ADC raw"
// @control readout volts label="Voltage" unit="V"
const int SENSOR = 34;   // GPIO34 is input-only — perfect for a sensor

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
}

void loop() {
  int raw = analogRead(SENSOR);
  float volts = raw * 3.3 / 4095.0;
  controlPublish("raw", raw);
  controlPublish("volts", volts);
  Serial.println(raw);
  delay(100);
}
`,
  },
  {
    label: 'PWM fade (LEDC)',
    code: `// The ESP32 has no analogWrite() in the classic sense — PWM comes from the
// LEDC peripheral. Core 3.x style: ledcAttach(pin, freq, resolutionBits).
const int LED = 2;

void setup() {
  Serial.begin(115200);
  ledcAttach(LED, 5000, 8);     // 5 kHz, 8-bit duty (0..255)
}

void loop() {
  for (int duty = 0; duty <= 255; duty += 5) {
    ledcWrite(LED, duty);
    delay(10);
  }
  for (int duty = 255; duty >= 0; duty -= 5) {
    ledcWrite(LED, duty);
    delay(10);
  }
}
`,
  },
  {
    label: 'Servo sweep',
    code: `#include <Servo.h>

// Any PWM-capable GPIO works for a servo on the ESP32.
Servo arm;
const int SERVO_PIN = 13;

void setup() {
  Serial.begin(115200);
  arm.attach(SERVO_PIN);
}

void loop() {
  for (int a = 0; a <= 180; a += 2) { arm.write(a); delay(15); }
  for (int a = 180; a >= 0; a -= 2) { arm.write(a); delay(15); }
}
`,
  },
  {
    label: 'Capacitive touch',
    code: `// GPIO 4 is one of the ESP32's touch pins (T0..T9).
// @control readout touch label="Touch value"
const int TOUCH_PIN = 4;
const int LED = 2;

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
}

void loop() {
  int v = touchRead(TOUCH_PIN);
  controlPublish("touch", v);
  digitalWrite(LED, v < 40 ? HIGH : LOW);   // lower value = touched
  delay(100);
}
`,
  },
  {
    label: 'DAC output',
    code: `// GPIO 25 and 26 are true analog outputs (8-bit DAC, 0..255).
// @control slider level 0 255 value=128 label="DAC level"
const int DAC_PIN = 25;

void setup() {
  Serial.begin(115200);
}

void loop() {
  int level = controlValue("level");
  dacWrite(DAC_PIN, level);
  delay(20);
}
`,
  },
  {
    label: 'Simulation controls',
    code: `// Controls are DECLARED by the sketch and appear in Run → Simulation.
// @control toggle  power              on   label="Power"
// @control slider  speed   0 255   value=140 step=5 label="Speed"
// @control select  mode    idle,drive,spin  label="Mode"
// @control button  horn                     label="Horn"
// @control readout out_duty                 label="Motor duty"
const int MOTOR = 23;
const int BUZZ  = 18;

void setup() {
  Serial.begin(115200);
  ledcAttach(MOTOR, 5000, 8);
  pinMode(BUZZ, OUTPUT);
}

void loop() {
  int duty = 0;
  if (controlValue("power")) {
    int mode = controlValue("mode");        // select gives the option index
    int speed = controlValue("speed");
    if (mode == 1) duty = speed;
    else if (mode == 2) duty = speed / 2;
  }
  ledcWrite(MOTOR, duty);
  controlPublish("out_duty", duty);
  digitalWrite(BUZZ, controlValue("horn"));
  delay(30);
}
`,
  },
  {
    label: 'Wi-Fi station',
    code: `#include <WiFi.h>

// Simulated in Constructa: the connection sequence, status codes and IP are
// modelled, but the browser has no radio. Watch Run → Simulation → Network.
const char* SSID = "constructa-lab";
const char* PASS = "robotics123";

void setup() {
  Serial.begin(115200);
  WiFi.begin(SSID, PASS);
  Serial.print("connecting");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }
  Serial.println("");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  Serial.print("RSSI ");
  Serial.println(WiFi.RSSI());
  delay(2000);
}
`,
  },
  {
    label: 'Wi-Fi access point',
    code: `#include <WiFi.h>

// @control readout clients label="AP clients"

void setup() {
  Serial.begin(115200);
  WiFi.softAP("constructa-bot", "12345678");
  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());
}

void loop() {
  controlPublish("clients", WiFi.softAPgetStationNum());
  delay(1000);
}
`,
  },
  {
    label: 'Bluetooth Classic (SPP)',
    code: `#include <BluetoothSerial.h>

// Bluetooth Classic SPP — real on an ESP32, SIMULATED here (and note that the
// Web Bluetooth API cannot reach Classic SPP at all from a browser).
// Use Run → Simulation → Network to connect a simulated phone and send text.
BluetoothSerial SerialBT;
const int LED = 2;

void setup() {
  Serial.begin(115200);
  SerialBT.begin("Constructa-ESP32");
  pinMode(LED, OUTPUT);
  Serial.println("pair with Constructa-ESP32");
}

void loop() {
  while (SerialBT.available()) {
    String cmd = SerialBT.readStringUntil('\\n');
    if (cmd == "on")  { digitalWrite(LED, HIGH); SerialBT.println("led on"); }
    if (cmd == "off") { digitalWrite(LED, LOW);  SerialBT.println("led off"); }
  }
  delay(20);
}
`,
  },
  {
    label: 'BLE serial control',
    code: `#include <BLESerial.h>

// BLE UART style control. Simulated here; on real hardware a phone app or a
// Web-Bluetooth page would write to the characteristic.
// @control slider speed 0 255 value=0 label="Speed (BLE sets this too)"
BLESerial ble;
const int MOTOR = 23;
int speed = 0;

void setup() {
  Serial.begin(115200);
  ble.begin("Constructa-BLE");
  ledcAttach(MOTOR, 5000, 8);
}

void loop() {
  while (ble.available()) {
    String cmd = ble.readStringUntil('\\n');
    if (cmd == "fast") speed = 255;
    else if (cmd == "slow") speed = 90;
    else if (cmd == "stop") speed = 0;
    ble.print("speed=");
    ble.println(speed);
  }
  ledcWrite(MOTOR, speed);
  delay(20);
}
`,
  },
  {
    label: 'Serial command parser',
    code: `// Send lines from Run → Simulation → Log to reach Serial.read().
const int LED = 2;

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  Serial.println("commands: on | off | blink");
}

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\\n');
    if (cmd == "on")  digitalWrite(LED, HIGH);
    if (cmd == "off") digitalWrite(LED, LOW);
    if (cmd == "blink") {
      for (int i = 0; i < 6; i++) { digitalWrite(LED, i % 2); delay(150); }
    }
    Serial.print("ok: ");
    Serial.println(cmd);
  }
  delay(20);
}
`,
  },
  {
    label: 'Two-motor drive',
    code: `// Differential drive on an ESP32: two PWM channels, two direction pins.
// @control slider throttle -255 255 value=0 step=5 label="Throttle"
// @control slider steer    -255 255 value=0 step=5 label="Steer"
// @control readout left  label="Left duty"
// @control readout right label="Right duty"
const int L_PWM = 23, R_PWM = 22;

void setup() {
  Serial.begin(115200);
  ledcAttach(L_PWM, 5000, 8);
  ledcAttach(R_PWM, 5000, 8);
}

int clamp255(int v) { return v > 255 ? 255 : (v < -255 ? -255 : v); }

void loop() {
  int t = controlValue("throttle");
  int s = controlValue("steer");
  int l = clamp255(t + s);
  int r = clamp255(t - s);
  ledcWrite(L_PWM, abs(l));
  ledcWrite(R_PWM, abs(r));
  controlPublish("left", l);
  controlPublish("right", r);
  delay(30);
}
`,
  },
]
