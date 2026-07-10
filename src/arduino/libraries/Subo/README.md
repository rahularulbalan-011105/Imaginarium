# Subo — official AtumX SUBO board library (mirror)

These files are a **verbatim mirror of the official SUBO Arduino library**
(AtumX, `https://github.com/AtumX-Official/SuboLibrary`) and are the **single
source of truth** for the simulator's SUBO board support:

```
Subo.h / Subo.cpp             LED matrix (48-px NeoPixel) + buzzer API + pin map
MotorExpansion.h / .cpp       2-motor expansion board (ESP32 LEDC PWM, IO18–IO21)
pitches.h                     NOTE_* frequency constants (HiBit, 2021)
library.properties            Arduino library manifest
keywords.txt                  Arduino IDE highlighting
```

**Do not edit these to fit the simulator.** The originals stay intact; the
simulator adapts to them:

- **Pin map** — `SUBO_BUZZER_PIN`, `SUBO_LED_PIN/NUM`, `SUBO_BUTTONR/L`, and
  `IO1..IO21 → GPIO` are mirrored 1:1 in `src/stores/electronicsStore.js`
  (`SUBO_IO_TO_GPIO`, `SUBO_ADC_IOS`) and the runtime `SUBO_CONSTS`.
- **API** — `SuboMatrixInit / setAllLED / setSingleLED / stripclear /
  playLEDSeq / playTone / stopBuzzer / playBuzSeq / start_motors /
  drive_motors / runMotor` are provided to the sketch by the runtime
  **compatibility layer** in `src/managers/SimulationManager.js` (the browser
  can't run ESP32 LEDC / NeoPixel / FreeRTOS code directly, so those hardware
  calls are translated into simulator behaviour — the on-board matrix lights up
  the 3D board, the buzzer plays real Web-Audio tones, the motor PWM drives any
  wired motors).
- **Constants** — `NOTE_*` from `pitches.h` are injected so official melody
  examples compile unchanged.

A user writes the **same code they would on real hardware** — `#include <Subo.h>`,
`SuboMatrixInit()`, `setAllLED(...)`, `playTone(...)`, `runMotor("F", 200)` — and
it runs in the simulator.
