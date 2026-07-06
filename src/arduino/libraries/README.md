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

These are standard `.ino` sketches — open one, paste it into the Code panel, and
press Run.
