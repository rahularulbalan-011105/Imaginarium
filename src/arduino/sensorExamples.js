// ─────────────────────────────────────────────────────────────────────────────
// Example sketches for the module + I²C sensors (Templates menu in the Code
// tab). Each is a standard Arduino sketch with the module's REAL behaviour, so
// it runs unchanged on hardware. On the simulator's Arduino every header pin
// is a D pin, so analog outputs are wired to a D pin and read with analogRead(pin).
// The same sketches ship as .ino files in src/arduino/libraries/examples/.
// ─────────────────────────────────────────────────────────────────────────────

export const PIR_EXAMPLE_SKETCH = `// PIR motion alarm — HC-SR501
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
`

export const FLAME_EXAMPLE_SKETCH = `// Flame alarm — IR flame module (LM393)
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
`

export const SOIL_EXAMPLE_SKETCH = `// Plant watering monitor — YL-69 probe + YL-38 board
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
`

export const RAIN_EXAMPLE_SKETCH = `// Rain detector — FC-37 rain plate
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
`

export const SOUND_EXAMPLE_SKETCH = `// Clap switch — KY-038 sound sensor
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
`

export const TOUCH_EXAMPLE_SKETCH = `// Touch lamp — TTP223 capacitive touch
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
`

export const HALL_EXAMPLE_SKETCH = `// Magnet detector — A3144 Hall sensor (KY-003)
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
`

export const BMP280_EXAMPLE_SKETCH = `// Barometer + altimeter — BMP280 (Adafruit_BMP280 library)
// Wiring: VCC -> 5V, GND -> GND, SCL -> SCL (A5), SDA -> SDA (A4)
// The purple GY-BMP280 board answers at 0x76 (wire SDO -> VCC for 0x77).
#include <Wire.h>
#include <Adafruit_BMP280.h>

Adafruit_BMP280 bmp;

void setup() {
  Serial.begin(9600);
  if (!bmp.begin(0x76)) {
    Serial.println("Could not find a valid BMP280 sensor, check wiring!");
    while (1) delay(10);
  }
}

void loop() {
  Serial.print("Temperature = ");
  Serial.print(bmp.readTemperature());
  Serial.println(" C");

  Serial.print("Pressure = ");
  Serial.print(bmp.readPressure() / 100.0);
  Serial.println(" hPa");

  Serial.print("Approx altitude = ");
  Serial.print(bmp.readAltitude(1013.25));
  Serial.println(" m");

  Serial.println();
  delay(2000);
}
`

export const ACCEL_EXAMPLE_SKETCH = `// Tilt meter — MPU6050 accelerometer (MPU6050_light library)
// Wiring: VCC -> 5V, GND -> GND, SCL -> SCL (A5), SDA -> SDA (A4)
// Tilt the board (rotate it in the scene in Auto mode) and watch the angles.
#include <Wire.h>
#include <MPU6050_light.h>

MPU6050 mpu(Wire);

void setup() {
  Serial.begin(9600);
  Wire.begin();
  byte status = mpu.begin();
  Serial.print("MPU6050 status: ");
  Serial.println(status);
  while (status != 0) { }          // stop if the MPU6050 is not found
  Serial.println("Calculating offsets, do not move the MPU6050");
  delay(1000);
  mpu.calcOffsets();
  Serial.println("Done!");
}

void loop() {
  mpu.update();
  Serial.print("ACC X: "); Serial.print(mpu.getAccX());
  Serial.print("  Y: ");   Serial.print(mpu.getAccY());
  Serial.print("  Z: ");   Serial.print(mpu.getAccZ());
  Serial.print("  | angle X: "); Serial.print(mpu.getAngleX());
  Serial.print("  Y: ");          Serial.println(mpu.getAngleY());
  delay(250);
}
`

export const GYRO_EXAMPLE_SKETCH = `// Turn tracker — MPU6050 gyroscope (MPU6050_light library)
// Wiring: VCC -> 5V, GND -> GND, SCL -> SCL (A5), SDA -> SDA (A4)
// Spin the board about its Z axis: rotation rate in deg/s, heading in degrees.
#include <Wire.h>
#include <MPU6050_light.h>

MPU6050 mpu(Wire);

void setup() {
  Serial.begin(9600);
  Wire.begin();
  byte status = mpu.begin();
  while (status != 0) { }
  mpu.calcOffsets();               // keep it still while it calibrates
}

void loop() {
  mpu.update();
  Serial.print("GYRO X: "); Serial.print(mpu.getGyroX());
  Serial.print("  Y: ");    Serial.print(mpu.getGyroY());
  Serial.print("  Z: ");    Serial.print(mpu.getGyroZ());
  Serial.print("  | heading Z: "); Serial.println(mpu.getAngleZ());
  delay(100);
}
`

export const SENSOR_EXAMPLES = [
  { label: 'PIR: motion alarm',               code: PIR_EXAMPLE_SKETCH,    file: 'PIR_MotionAlarm' },
  { label: 'Flame sensor: fire alarm',        code: FLAME_EXAMPLE_SKETCH,  file: 'Flame_FireAlarm' },
  { label: 'Soil moisture: plant monitor',    code: SOIL_EXAMPLE_SKETCH,   file: 'SoilMoisture_PlantMonitor' },
  { label: 'Rain sensor: rain detector',      code: RAIN_EXAMPLE_SKETCH,   file: 'Rain_Detector' },
  { label: 'Sound sensor: clap switch',       code: SOUND_EXAMPLE_SKETCH,  file: 'Sound_ClapSwitch' },
  { label: 'Touch sensor: touch lamp',        code: TOUCH_EXAMPLE_SKETCH,  file: 'Touch_Lamp' },
  { label: 'BMP280: pressure + altitude',     code: BMP280_EXAMPLE_SKETCH, file: 'BMP280_Altimeter' },
  { label: 'Accelerometer: MPU6050 tilt',     code: ACCEL_EXAMPLE_SKETCH,  file: 'MPU6050_Tilt' },
  { label: 'Gyroscope: MPU6050 turn rate',    code: GYRO_EXAMPLE_SKETCH,   file: 'MPU6050_Gyro' },
  { label: 'Hall sensor: magnet detector',    code: HALL_EXAMPLE_SKETCH,   file: 'Hall_MagnetDetector' },
]
