# ESP32 in Constructa

Constructa supports the **ESP32-WROOM-32 on the 30-pin DevKit V1 header** as a
first-class microcontroller alongside Arduino and SUBO: you can place the board,
wire it, write Arduino-ESP32 style C++ against it, and run that firmware in the
simulator with Wi-Fi, Bluetooth and your own on-screen controls.

This document says exactly **what is real, what is simulated, and what is not
possible in a browser**, so nobody is surprised later.

---

## 1. What the three layers mean

| Layer | What it is | Status |
|---|---|---|
| **Editor** | The board model, pin table, wiring, code editing, diagnostics | Real. The pin table is the single source of truth for the 3D board, the wiring UI and the compiler checks. |
| **Simulator** | Your sketch running in Constructa: GPIO, PWM, ADC, DAC, touch, Serial, Wi-Fi, Bluetooth, controls | Simulated. The sketch is transpiled to JavaScript and run in a sandboxed iframe. Timing, electrical limits and radios are models, not hardware. |
| **Hardware** | A physical ESP32 on USB | Partially available, **untested**. See [§7](#7-real-hardware). |

**A browser cannot compile or flash ESP32 firmware.** Real firmware needs the
Arduino-ESP32 / ESP-IDF toolchain (`arduino-cli`, `idf.py`), which does not run
in a tab. Constructa does not pretend otherwise: there is no "compile" or
"upload" button that quietly does something else. What Constructa *does* give
you is a pre-flight analyzer (the same one Arduino and SUBO use, with ESP32
rules added) and an execution model faithful enough to develop logic against.

---

## 2. The board and its pins

`src/utils/esp32Board.js` holds **one** table, `ESP32_PINS` (30 entries, 15 per
side), and everything else derives from it:

* the 3D board's pin spheres and labels (`electronicsFactory.createEsp32Group`),
* the wiring UI's pin list (`PIN_DEFS.esp32`),
* `validateEsp32Pin(gpio, use)`, used by the compiler checks and by `@control
  … pin=`.

Facts encoded there:

| Property | Value |
|---|---|
| Logic level | 3.3 V (**not** 5 V tolerant) |
| ADC | 12-bit, `analogRead()` → **0–4095** |
| ADC1 (safe with Wi-Fi) | GPIO 32, 33, 34, 35, 36, 39 |
| ADC2 (unusable while Wi-Fi is on) | GPIO 2, 4, 12, 13, 14, 15, 25, 26, 27 |
| Input-only | GPIO 34, 35, 36, 39 |
| DAC (true analog out, 8-bit) | GPIO 25, 26 |
| Capacitive touch | GPIO 4 (T0), 2, 15, 13, 12, 14, 27, 33, 32 |
| Strapping pins (warn) | GPIO 2, 5, 12, 15 |
| Flash — never usable | GPIO 6–11 (not on this header) |
| PWM | LEDC on any output-capable pin |

The 30-pin DevKit V1 header does not break out GPIO 0 or 6–11, so asking for
them is an error, not a warning.

---

## 3. Writing firmware

Pick an ESP32 example from **CODE → C++ Coding → Templates** (the list switches
to the ESP32 set whenever an ESP32 is in the scene). The supported API is the
Arduino-ESP32 one:

```cpp
// GPIO
pinMode(4, INPUT_PULLDOWN);  digitalRead(4);  digitalWrite(2, HIGH);

// PWM — the ESP32 uses LEDC, not analogWrite()
ledcAttach(23, 5000, 8);     // core 3.x: pin, frequency, resolution bits
ledcWrite(23, 128);          // duty 0..255 at 8-bit
ledcSetup(0, 5000, 8); ledcAttachPin(23, 0); ledcWrite(0, 128);   // core 2.x style also works

// Analog
analogReadResolution(12);    int raw = analogRead(34);   // 0..4095
dacWrite(25, 200);           // true analog out
int t = touchRead(4);        // capacitive touch

// Serial, Servo and the sensor libraries behave exactly as on other boards
Serial.begin(115200);  Serial.println(raw);
```

### Diagnostics

`analyzeArduino(code, { board: 'esp32' })` runs before execution and **blocks on
errors**:

* **Errors** — a pin that does not exist on the header, an input-only pin used
  as an output, `dacWrite` on a pin with no DAC, `analogRead` on a pin with no
  ADC, `touchRead` on a non-touch pin, flash pins, SUBO API on an ESP32, ESP32
  API on an Arduino/SUBO board, plus every existing syntax/arity check.
* **Warnings** (never blocking) — strapping pins, ADC2 pins (they stop working
  while Wi-Fi is on), USB-serial pins.

Pin checks only fire for a **literal** argument (`pinMode(34, OUTPUT)`), never
for a variable or expression: the analyzer is precision-first and will not guess.

---

## 4. Program-defined simulation controls

A sketch **declares** the controls it wants, and they appear under
**SIMULATE → Simulator → ESP32 → Controls**. Nothing is inferred from arbitrary
C++, so the UI can never misread your code.

```cpp
// @control toggle  power              on   label="Power"
// @control slider  speed   0 255   value=140 step=5 unit="%"
// @control select  mode    idle,drive,spin
// @control button  horn                     label="Horn"
// @control number  target  0 3000  value=1200
// @control readout out_duty                 label="Motor duty"
```

Grammar: `@control <type> <id> [range/options] [key=value …]`, one per line,
inside a `//` or `/* */` comment. Keys: `label`, `value`, `step`, `unit`,
`group`, `pin` (validated against the board table).

Read and publish from firmware:

```cpp
int v = controlValue("speed");    // numbers; toggle/button = 1/0; select = option INDEX
controlPublish("out_duty", v);    // pushes a value into a readout
```

Bad declarations are reported with their line number and are visible in the panel
rather than silently dropped.

---

## 5. Wi-Fi (simulated)

```cpp
#include <WiFi.h>
WiFi.begin(ssid, pass);     // associates after ~1–2 s
WiFi.status();              // WL_IDLE_STATUS → WL_CONNECTED / WL_NO_SSID_AVAIL
WiFi.localIP(); WiFi.RSSI(); WiFi.macAddress();
WiFi.softAP("constructa-bot", "12345678");   WiFi.softAPIP();
WiFiClient client;  client.connect(host, port);  client.println("hi");
```

The state machine, status codes, IP, RSSI and MAC are modelled, and the
**Network** tab shows them live, labelled `SIMULATED`. An empty SSID fails with
`WL_NO_SSID_AVAIL`; everything else associates. Client writes land in the
network log — there is **no real socket**, no DNS, no internet access.

**Credentials:** SSIDs and passwords written in a sketch live only in that
sketch's text. Constructa does not copy them into project metadata, analytics or
logs (the Wi-Fi log records the SSID being joined, never the password). Treat a
shared project exactly like shared source code.

---

## 6. Bluetooth (simulated)

```cpp
#include <BluetoothSerial.h>      BluetoothSerial SerialBT;   // Classic SPP
#include <BLESerial.h>            BLESerial ble;              // BLE UART
SerialBT.begin("Constructa-ESP32");
while (SerialBT.available()) { String cmd = SerialBT.readStringUntil('\n'); … }
SerialBT.println("ok");
```

In the **Network** tab you can connect a simulated phone and type lines to the
board; the sketch's replies appear in the log.

Why this is simulated rather than real:

* **Bluetooth Classic SPP is not reachable from a browser at all.** The Web
  Bluetooth API only speaks BLE GATT.
* Web Bluetooth itself is Chromium-only (no Firefox, no Safari/iOS), needs HTTPS
  and a user gesture, and would require the board to advertise a matching BLE
  service.

So Constructa models both, and says so in the UI instead of implying a radio
link that is not there.

---

## 7. Real hardware

`src/managers/esp32Link.js` is the seam for a physical board, over **Web Serial**
(USB CDC). It can request a port, open it at 115200 baud and exchange lines with
a board that is **already flashed**.

Honest limits:

* **Not verified against a physical ESP32.** No board was attached when this was
  written; capability detection is real, byte-level behaviour with a specific
  device is unproven. The panel says so.
* Web Serial is Chromium-only (Chrome/Edge desktop) and needs HTTPS or
  localhost. Firefox and Safari do not implement it.
* Flashing is **not** offered: it needs esptool's protocol plus a compiled
  binary, and the binary cannot be produced in a browser.
* The "Treat this board as real hardware" switch only changes how the panel
  presents the board. It never fabricates a connection.

If you want a real round trip today: develop the logic in Constructa, copy the
sketch into the Arduino IDE / `arduino-cli` with the ESP32 core installed, and
flash from there.

---

## 8. Files

| File | Role |
|---|---|
| `src/utils/esp32Board.js` | The pin table, `validateEsp32Pin`, name↔GPIO helpers |
| `src/utils/esp32Controls.js` | `@control` annotation parser + defaults |
| `src/utils/esp32Examples.js` | The example sketches (lazy chunk) |
| `src/utils/electronicsFactory.js` | `createEsp32Group()` — board mesh + pins from the table |
| `src/managers/sketchSandbox.js` | ESP32 API shims (LEDC, DAC, touch, WiFi, Bluetooth, controls) |
| `src/managers/SimulationManager.js` | The ESP32 runtime state: radios, controls, readouts, log |
| `src/managers/esp32Link.js` | Web Serial seam for real hardware (untested) |
| `src/components/Esp32Panel.jsx` | Simulation-tab UI: controls, network, log |
| `src/utils/arduinoDiagnostics.js` | ESP32 board rules in the pre-flight analyzer |
| `tests/esp32/*.test.js` | Board/pin/control/diagnostic tests + sandbox parse guard |
| `tools/bench/esp32-e2e.cjs`, `esp32-persist.cjs` | Browser end-to-end checks |

## 9. Verified behaviour

What was actually run, not assumed:

* `npm test` — 24 ESP32 unit tests plus the pre-existing 73 physics tests.
* `tools/bench/esp32-e2e.cjs` — 12/12 in a real browser against the production
  build: board added from the library, ESP32 target recognised, examples loaded,
  Run enabled with no wiring, firmware running, all declared controls rendered,
  `controlPublish` readout following a slider, Wi-Fi reaching `WL_CONNECTED`
  with an IP, Bluetooth round trip (`fast` → `speed=255`), and the SIMULATED /
  Web-Serial labels present.
* `tools/bench/esp32-persist.cjs` — 7/7: export → New Project → import restores
  the ESP32, and no Wi-Fi credentials are written into the project file.
* `tools/bench/subo-regress.cjs` — 5/5: a SUBO sketch still compiles, runs and
  prints after the shared sandbox gained the ESP32 API.
* Not verified: anything involving a physical board.
