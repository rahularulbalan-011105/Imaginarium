# Arduino Sensor Libraries

Genuine Arduino-style libraries for the sensors added to the 3D Design Editor's
electronics simulator. They follow official Arduino library conventions (a class
per component, a `.h` header + `.cpp` implementation, `begin()` in `setup()`,
example sketches) so a beginner can copy real Arduino examples from the internet
with only minimal changes and have them compile and run in the simulator.

| Library | Include | Class | Key methods |
|---------|---------|-------|-------------|
| **LDR** | `#include <LDR.h>` | `LDR(pin)` | `begin()`, `read()`, `readPercentage()` |
| **DHT11** | `#include <DHT11.h>` | `DHT11(pin)` | `begin()`, `readTemperature()`, `readHumidity()` |
| **ColorSensor** | `#include <ColorSensor.h>` | `ColorSensor(S0,S1,S2,S3,OUT)` | `begin()`, `readRGB()`, `readColor()`, `readRed()`, `readGreen()`, `readBlue()` |

`readRGB()` returns an `RGB { r, g, b }` struct.

## How this maps to the simulator

- The `.h`/`.cpp` files are the reference implementation you would drop into a
  real Arduino IDE `libraries/` folder. They document the exact API.
- Inside the simulator, `#include <...>` directives are accepted and each class
  is provided at runtime by `src/arduino/sensorLibs.js`, mirroring these APIs
  method-for-method — exactly the way the built-in `Servo` class already works.
- All simulated readings flow through one reusable interface,
  `src/arduino/sensorSim.js`, so realistic scene-driven behaviour can be added
  later in a single place. Readings honour any manual value set in the sensor
  panel while a simulation is running.

## Examples

- `examples/LDR_ReadLight/`
- `examples/DHT11_ReadTempHumidity/`
- `examples/ColorSensor_DetectColor/`
- `examples/PIR_MotionAlarm/` · `examples/Flame_FireAlarm/` · `examples/SoilMoisture_PlantMonitor/`
- `examples/Rain_Detector/` · `examples/Sound_ClapSwitch/` · `examples/Touch_Lamp/` · `examples/Hall_MagnetDetector/`
- `examples/BMP280_Altimeter/` · `examples/MPU6050_Tilt/` · `examples/MPU6050_Gyro/`

These are standard `.ino` sketches — open one, paste it into the Code panel, and
press Run.

## Module and I²C sensors

These sensors need no Constructa library. The digital/analog modules are read with
`digitalRead` / `analogRead`, and the I²C boards use the standard third-party
libraries (install them from the Arduino Library Manager on real hardware). The
simulator provides those libraries' APIs at runtime (`src/managers/sketchSandbox.js`),
and every reading comes from `src/arduino/sensorSim.js`.

| Part | Module | Pins | Output (real polarity) |
|------|--------|------|------------------------|
| PIR | HC-SR501 | VCC OUT GND | OUT HIGH while motion is seen (held ~3 s) |
| Flame | LM393 IR flame | VCC GND DO AO | DO LOW on flame · AO falls as the flame grows |
| Soil moisture | YL-69 + YL-38 | VCC GND DO AO | DO LOW when wet · AO ≈1023 dry → ≈250 wet |
| Rain | FC-37 | VCC GND DO AO | DO LOW when wet · AO falls when wet |
| Sound | KY-038 | AO GND VCC DO | DO HIGH on a loud sound · AO ≈512 ± the sound |
| Touch | TTP223 | GND I/O VCC | I/O HIGH while touched |
| Hall | A3144 (KY-003) | GND VCC S | S LOW when a magnet is near |
| Pressure | GY-BMP280 | VCC GND SCL SDA CSB SDO | I²C 0x76 (SDO → VCC: 0x77) |
| Accelerometer / Gyroscope | GY-521 (MPU6050) | VCC GND SCL SDA XDA XCL AD0 INT | I²C 0x68 (AD0 → VCC: 0x69) |

| Library | Include | Class | Methods provided |
|---------|---------|-------|------------------|
| **Adafruit_BMP280** | `#include <Adafruit_BMP280.h>` | `Adafruit_BMP280 bmp;` | `begin(addr)` (default 0x77), `readTemperature()`, `readPressure()` (Pa), `readAltitude(seaLevel_hPa)`, `setSampling()`, `sensorID()` |
| **MPU6050_light** | `#include <MPU6050_light.h>` | `MPU6050 mpu(Wire);` | `begin()` (0 = OK), `update()`, `calcOffsets()`, `getAccX/Y/Z()` (g), `getGyroX/Y/Z()` (°/s), `getAngleX/Y/Z()`, `getAccAngleX/Y()`, `getTemp()`, `setAddress()` |

In **Auto** mode the PIR watches the scene above its dome, the BMP280 adds the
part's height to its altitude, and the MPU6050 reads the part's real tilt,
rotation and acceleration (`src/arduino/motionSim.js`).
