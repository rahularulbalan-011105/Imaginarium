# Constructa — Complete Feature Reference

> **What this is:** an exhaustive, code-accurate reference for the entire Constructa (internal repo **Imaginarium**) platform — every subsystem, when and how code executes, the electronics and their libraries, the compiler, the physics, the full UI page-map, and every dependency. Every claim is traced to the actual source (`file:line`) on the **`sureshv1`** branch.
>
> **Generated:** 2026-07-15 · **Branch:** `sureshv1` · **Version:** 1.8.0
> **Stack:** React 18 · Three.js 0.168 · Zustand 5 · Rapier (WASM) · Tailwind 3.4 · Vite 5 · Electron shell. No backend — persists to IndexedDB.

---

## How to read this document

It is organised as **five parts**, each written from the code itself:

| Part | Covers | Answers the question… |
|---|---|---|
| **[Part 1 — Electronics & Libraries](#part-1--electronics-components-their-libraries--wiring)** | Every board/motor/sensor, its 3D model, pin maps, the shipped Arduino libraries, wiring | *What electronics exist and what libraries do they use?* |
| **[Part 2 — Code, Compiler & Execution](#part-2--code-editor-compiler-diagnostics--execution)** | The Code panel, compiler diagnostics, the parser/transpiler, and the exact run lifecycle & timing | *When and how does the code execute?* |
| **[Part 3 — Simulation, Physics & Combat](#part-3--simulation-physics-robots--combat)** | Environments, wheeled/legged drive, mass/physics, Robo-Sumo, the Physics Arena | *How does a robot actually move and fight?* |
| **[Part 4 — UI Page-Map & CAD Tools](#part-4--ui-page-map-cad-tools--shortcuts)** | Where every option lives on the page, all CAD tools, the full shortcut table | *Where do I click for X?* |
| **[Part 5 — Dependencies & Infrastructure](#part-5--dependencies-build--infrastructure)** | Every package + version, build/deploy, security headers, state stores, storage, analytics | *What is it built on and how does it ship?* |

---

## Your key questions answered up front

**⏱️ When does the code execute, and for how long?**
- Code runs the moment you press **▶ Run Code** in the **Code** panel (right rail → *Program → Code*) — **but only if the pre-flight compiler check passes with zero errors** (`CodeEditor.jsx:235-237`). Blocking errors withhold execution and show a compiler report instead.
- On run: your `setup()` executes **exactly once**, then `loop()` executes **repeatedly, forever**, in an async loop: `setup(); while(running){ await loop(); await __yield(); }` (`SimulationManager.js:437-447`).
- There is **no fixed duration** — it runs until you press **■ Stop Code** (or Stop Simulation). Timing primitives: `delay(ms)` = `setTimeout(max(1, ms))`; a mandatory `__yield()` (`setTimeout(0)`) runs once per `loop()` iteration so a `loop()` with no `delay()` can't freeze the browser. `stop()` interrupts by rejecting with `'stopped'`, which the sandbox swallows.
- What the code produces each tick: it writes to four output channels the simulator reads — **`motorSpeeds`** (±255), **`servoAngles`** (0–180°), **`ledBrightness`** (0–255), and **`leggedDrive`** (±8 u/s, ±1.8 rad/s from `walk()`/`turn()`). Motor net speed = terminal A − terminal B.

**🔌 What electronics and libraries?** → Part 1. 18 wireable/combat parts; genuine Arduino libraries `Subo`, `MotorExpansion`, `LDR`, `DHT11`, `ColorSensor` ship in `src/arduino/libraries/`; runtime sensor classes are injected into the sketch like the `Servo` class.

**🧮 What compiler?** → Part 2. `analyzeArduino()` (`arduinoDiagnostics.js`) is an Arduino-IDE-style diagnostics pass (errors + warnings + "did you mean" suggestions) that gates execution; `arduinoParser.js` is a full C++ lexer → parser → JavaScript transpiler that runs in a sandbox.

**📦 What dependencies?** → Part 5, with an exact version table from `package.json`.

**🖱️ Where is option X on the page?** → Part 4, a complete page-map of the Header, floating toolbox, and right icon-rail.

---

## How it all fits together (end-to-end flow)

Constructa is a pipeline from **CAD → electronics → wiring → code → simulation → battle**, with each stage feeding the next:

```
   ┌────────────┐   ┌─────────────┐   ┌──────────┐   ┌───────────┐   ┌────────────┐   ┌──────────┐
   │  1. DESIGN │──▶│ 2. ELECTRON.│──▶│ 3. WIRE  │──▶│ 4. PROGRAM│──▶│ 5. COMPILE │──▶│ 6. RUN + │
   │  shapes/   │   │  add board, │   │ pin-to-  │   │ C++ code  │   │ diagnostics│   │ SIMULATE │
   │  CAD tools │   │ motors,     │   │ pin      │   │  OR blocks│   │  gate      │   │ physics  │
   │            │   │ sensors     │   │ (conn.)  │   │           │   │            │   │ drives it│
   └────────────┘   └─────────────┘   └──────────┘   └───────────┘   └────────────┘   └────┬─────┘
        Library         Elec            Wiring          Code/Blocks     (auto on Run)        │
       (rail)          (rail)          (rail)           (rail)                               ▼
                                                                                    ┌──────────────┐
                                                                                    │ 7. BATTLE /  │
                                                                                    │ COMBAT ARENA │
                                                                                    └──────────────┘
```

1. **Design** — build geometry with primitives/booleans/extrude/fillet/slice (Part 4). Objects live in `sceneStore`.
2. **Electronics** — drop in an Arduino/SUBO board, motors, servos, LEDs, sensors from the **Elec** section (Part 1). Components live in `electronicsStore`.
3. **Wire** — connect pins in the **Wiring** section; connections are stored in `electronicsStore.connections` and drawn as 3D wires by `WireManager`. Sensors only read real values when **correctly powered + grounded + signal-wired** (Part 1).
4. **Program** — write Arduino C++ in the **Code** panel, or snap **Blocks** together (which generate the same C++).
5. **Compile** — pressing Run first calls `analyzeArduino()`; errors block execution and open the compiler report (Part 2).
6. **Run + Simulate** — clean code is transpiled to JS and executed (setup once → loop forever). Its output channels (`motorSpeeds`, `servoAngles`, `leggedDrive`, …) are read by **`DriveManager`**, which — inside a physics simulation (Rapier / kinematic fallback) — turns them into actual motion: wheeled differential drive or a legged gait (Part 3).
7. **Battle / Arena** — the assembled robot can enter **Robo-Sumo** (arcade physics) or the **Physics Arena** (Rapier one-body-per-robot combat vs AI) (Part 3).

**Underneath everything:** ~14 Zustand **stores** hold declarative state; imperative **managers** own all Three.js/physics/network mutation; **utils** are pure helpers. Projects autosave to **IndexedDB** every 30 s and can be shared via URL-hash links. See Part 5.

---

## ⚠️ Documentation-vs-code caveats found while writing this

These are places where the code on `sureshv1` differs from older docs — flagged for accuracy:

- **Google Drive integration is NOT present on this branch.** The ☰ File menu (`Header.jsx:255-268`) offers only New / Open / Import-Export JSON / Copy Share Link / Export STL — no Drive OAuth/picker is wired in, despite the roadmap listing it done.
- **`Cross-Origin-Embedder-Policy` (COEP) is not actually set** in any host config — only `COOP: same-origin-allow-popups` exists. Full cross-origin isolation for `SharedArrayBuffer` isn't enabled as written; this works anyway because Rapier uses the single-threaded `-compat` WASM build (no `SharedArrayBuffer` needed).
- **A 5th environment preset, `underwater`, exists** in `EnvironmentConfig.js` but is **not exposed** in the environment picker UI (only Earth / Moon / Mars / Zero-G show).
- The header logo text is literally **"🧊 3D Editor"**, not a Constructa wordmark, in the current code.

---


# Part 1 — Electronics Components, Their Libraries & Wiring

_Every board, motor, sensor & weapon — their 3D models, pin maps, Arduino libraries and wiring._

> Scope: every electronics part in Constructa/Imaginarium — the parts catalog, how each 3D
> model is built or loaded, pin definitions, the genuine Arduino libraries shipped with the app,
> the runtime simulator sensor classes, the wiring UI/data model, and where each lives in the UI.
> All claims are cited to `file:line`.

---

## 1. The Electronics Parts Catalog

The authoritative catalog is the `CATEGORIES` array in
`src/components/ElectronicsLibrary.jsx:13-57`. Clicking a part calls `addObject(type)` +
`snapshot()` (`ElectronicsLibrary.jsx:69`), where `type` is the exact string below. Icons and
descriptions are quoted verbatim from the source.

### MCUs (`ElectronicsLibrary.jsx:14-20`)

| type | label | icon | desc | purpose (verbatim) | usage |
|---|---|---|---|---|---|
| `arduino` | Arduino | 🟢 | Microcontroller board | The programmable "brain". Runs your code and controls everything wired to it. | robot brains · automation · reading sensors |
| `subo` | SUBO | 🟣 | ESP32 board (AtumX) | AtumX SUBO — an ESP32 board with an on-board 48-LED matrix, buzzer, 2 buttons and IO1–IO21 header pins. Programmed with the official Subo library. | robotics · 48-LED matrix · buzzer · buttons · motor expansion |

### Sensors (`ElectronicsLibrary.jsx:21-31`)

| type | label | icon | desc | purpose | usage |
|---|---|---|---|---|---|
| `ultrasonic` | Ultrasonic | 📡 | HC-SR04 distance | Measures distance. | obstacle avoidance · range finding |
| `ir_sensor` | IR Sensor | 👁 | Obstacle detect | Detects nearby obstacles. | line following · edge/obstacle detection |
| `gas_sensor` | Gas Sensor | 💨 | MQ combustible | Detects combustible gases. | gas-leak alarms · air quality |
| `color_sensor` | Color Sensor | 🎨 | TCS3200 RGB | Detects the dominant reflected colour. | colour sorting · line following |
| `ldr_sensor` | LDR Sensor | 🔆 | Light level | Measures ambient light intensity. | auto night-lights · light following |
| `dht11` | DHT11 | 🌡 | Temp + humidity | Measures temperature and humidity. | weather stations · climate logging |

### Displays (`ElectronicsLibrary.jsx:32-37`)

| type | label | icon | desc | purpose | usage |
|---|---|---|---|---|---|
| `oled` | OLED | 📺 | I²C 128×64 | Displays text and graphics. | readouts · menus · debugging |

### Actuators (`ElectronicsLibrary.jsx:38-47`)

| type | label | icon | desc | purpose | usage |
|---|---|---|---|---|---|
| `servo` | Servo Motor | 🔩 | Angle control actuator | Rotates to a specified angle (0–180°). | robot arms · steering · camera gimbals |
| `motor_dc` | DC Motor | 🔧 | Continuous rotation | Spins continuously at a set speed. | wheels · fans · propellers |
| `motor_bo` | BO Motor | ⚙ | Geared drive motor | A geared DC motor — high torque at low speed. | driving robot wheels |
| `led` | LED | 💡 | Light output | A light you can switch on/off or dim from code. | status indicators · signals |
| `buzzer` | Buzzer | 🔔 | Tone output | Plays tones and beeps from code. | alarms · feedback · melodies |

### Weapons (`ElectronicsLibrary.jsx:48-56`) — arena combat parts, not wireable electronics

| type | label | icon | desc | purpose | usage |
|---|---|---|---|---|---|
| `weapon_autocannon` | Auto Cannon | 🔫 | Sustained DPS | Continuous fire, armor break, crit on exposed core. | main gun · sustained damage |
| `weapon_shotgun` | Shotgun | 💥 | Burst + knockback | Pellet spread, short range, heavy knockback. | close-range brawling |
| `weapon_rocket` | Rocket Pod | 🚀 | Splash damage | Explosive rockets with area damage + knockback. | area denial · groups |
| `weapon_flame` | Flamethrower | 🔥 | Burn / area | Close cone that sets targets burning. | area denial · zoning |

### "Coming soon" placeholders (`ElectronicsLibrary.jsx:59-62`)
`power` (Batteries · supplies · regulators) and `comms` (WiFi · Bluetooth · RF) — rendered
disabled, `(0)` count, no items.

**Note — `motor` vs `motor_dc`/`motor_bo`:** the library only creates `motor_dc` and `motor_bo`.
A bare `motor` type still exists as a legacy alias in the wiring/pin tables and the elec-type set
(`WiringPanel.jsx:10`, `electronicsFactory.js:151`, `createMotorGroup` at `electronicsFactory.js:541`).

Each part button carries a guided-coach anchor `data-tour="elec-${type}"` (`ElectronicsLibrary.jsx:95`).

---

## 2. 3D Models — GLB Loading vs Procedural Fallback

### Model paths & scale targets (`src/utils/modelLoader.js`)

`MODEL_PATHS` (`modelLoader.js:31-47`) maps each type to a GLB under `public/models/`.
`MODEL_SCALE_TARGET` (`modelLoader.js:8-27`) normalises each model's longest bbox dimension to a
target size via `scaleAndCenter` (`modelLoader.js:128-142`). All 15 core models are preloaded at
boot by `preloadModels()` (`modelLoader.js:85-112`); a 404 caches `null` and the factory falls
back to procedural geometry (`modelLoader.js:106`).

| type | GLB file | scale target | Notes |
|---|---|---|---|
| `arduino` | `arduino_uno.glb` | 6.8 | `modelLoader.js:9,32` |
| `subo` | `subo.glb` | **none** (native GLB size) | Deliberately omitted from `MODEL_SCALE_TARGET` — authored to true 6.45×6.8 in Blender (`modelLoader.js:10-13`) |
| `motor_bo` | `motor_bo.glb` | 5.0 | `modelLoader.js:14,33` |
| `motor_dc` | `motor_dc.glb` | 5.0 | `modelLoader.js:15,34` |
| `led` | `led.glb` | 1.2 | `modelLoader.js:16,35` |
| `servo` | `servo.glb` | 4.0 | `modelLoader.js:17,36` |
| `free_wheels` | `free_wheels.glb` | 8.0 | wheels helper (not in elec library) `modelLoader.js:18,37` |
| `ir_sensor` | `ir_sensor.glb` | 3.0 | `modelLoader.js:19,38` |
| `ultrasonic` | `ultrasonic.glb` | 3.5 | `modelLoader.js:20,39` |
| `buzzer` | `buzzer.glb` | 2.2 | `modelLoader.js:21,40` |
| `oled` | `oled.glb` | 3.2 | `modelLoader.js:22,41` |
| `gas_sensor` | `gas_sensor.glb` | 3.2 | `modelLoader.js:23,42` |
| `color_sensor` | `color_sensor.glb` | 3.2 | `modelLoader.js:24,43` |
| `ldr_sensor` | `ldr.glb` (note filename) | 2.2 | `modelLoader.js:25,44` |
| `dht11` | `dht11.glb` | 2.6 | `modelLoader.js:26,45` |

All 15 GLBs confirmed present in `public/models/` (plus several `subo_*` backups/variants like
`subo_calibrated.glb`, `subo_old.glb`, `subo_prev.glb` — only `subo.glb` is the one loaded).

**Weapons** are lazy-loaded on arena entry (NOT preloaded): `WEAPON_PATHS`
(`modelLoader.js:54-59`) → `weapon_autocannon.glb`, `weapon_shotgun.glb`, `weapon_rocket.glb`,
`weapon_flame.glb`, with `WEAPON_SCALE` = 3.2 / 2.6 / 3.0 / 2.8 (`modelLoader.js:60`), fetched via
`loadWeaponModel(key)` (`modelLoader.js:64-82`). A missing weapon GLB → weapon still works, no mesh.

### Build functions (`src/utils/electronicsFactory.js`)

Every builder tries `cloneModel(type)` first, else builds procedural geometry.

| Component | Factory function | GLB builder | Procedural fallback |
|---|---|---|---|
| Arduino | `createArduinoGroup` (254) | `buildArduinoFromGLB` (260) — computes dynamic pins from real geometry | `buildArduinoProcedural` (338) — full green PCB + chip/xtal/USB/jack/headers |
| SUBO | `createSuboGroup` (396) | `buildSuboFromGLB` (468) | `buildSuboProcedural` (527) — dark board + 6×8 matrix hint; `attachSuboMatrix` (441) drives LED emissive |
| DC/BO motor | `createMotorGroup`/`createMotorBOGroup`/`createMotorDCGroup` (541-563) | `buildMotorFromGLB` (592) — auto-detects rotor shaft | `buildMotorProcedural` (623) — cylinder body + spinning rotor group |
| LED | `createLEDGroup` (686) | `buildLEDFromGLB` (692) — collects emissive meshes | `buildLEDProcedural` (709) — dome + anode/cathode leads |
| Servo | `createServoGroup` (755) | `buildServoFromGLB` (761) — detects horn, builds pivot | `buildServoProcedural` (855) — body + cross-arm horn + 3 wires |
| IR/Ultrasonic/Buzzer/Gas | `createIRSensorGroup`/`createUltrasonicGroup`/`createBuzzerGroup`/`createGasSensorGroup` (999-1002) | `buildModelComponent(name)` (987) | plain box `2×1×1.4` if GLB 404 |
| OLED | `createOLEDGroup` (1082) | `buildModelComponent('oled')` + `attachOledScreen` (1047) — canvas "screen" plane, `userData.oledScreen.update(text)` | box + procedural screen |
| Color sensor | `createColorSensorGroup` (1104) | GLB add | `sensorBoard` + photodiode lens + 4 corner LEDs |
| LDR | `createLDRGroup` (1125) | GLB add | `sensorBoard` + photoresistor disc + pot |
| DHT11 | `createDHT11Group` (1143) | GLB add | `sensorBoard` + blue perforated housing |

**Rotor detection** for motors: `findRotorNode` (`modelLoader.js:147-222`) — keyword pass then
"smallest-volume protruding mesh" geometric analysis; axis via `detectRotorAxis`
(`modelLoader.js:225-232`). BO motor uses a confirmed default shaft mesh name `Object_24`
(`electronicsFactory.js:548-556`). Servo uses a dedicated pivot wrapper `_setupServoPivot`
(`electronicsFactory.js:819-853`) rotating around Y.

---

## 3. Pin Definitions

Two parallel pin tables exist and are kept in sync:
- **`PIN_DEFS` in `WiringPanel.jsx:12-31`** — flat name lists used to render the pin-grid buttons.
- **`PIN_DEFS` in `electronicsFactory.js:151-167`** — full geometric defs (x/y/z, color, type,
  label) used to place clickable 3D pin spheres via `addPinSpheresToGroup`
  (`electronicsFactory.js:214-250`).

Pin `type` is one of `'pwm' | 'digital' | 'analog' | 'gnd' | 'power'` (`electronicsFactory.js:9`).

### Arduino (`WiringPanel.jsx:13`, `ARDUINO_PINS` `electronicsFactory.js:12-24`)

| Pin | Label | Type | Notes |
|---|---|---|---|
| D2 | ~2 | digital | |
| D3 | ~3 | pwm | |
| D4 | 4 | digital | |
| D5 | ~5 | pwm | |
| D6 | ~6 | pwm | |
| D7 | – | digital | in panel list; PWM set {3,5,6,9,10,11} |
| D8 | – | digital | |
| D9 | ~9 | pwm | |
| D10 | ~10 | pwm | |
| D11 | ~11 | pwm | |
| 5V | 5V | power | |
| GND1 | GND | gnd | |
| GND2 | GND | gnd | |

(The GLB path recomputes D2–D11 + 5V/GND1/GND2 dynamically along the real board edges — PWM set
`{3,5,6,9,10,11}`, `buildArduinoFromGLB` `electronicsFactory.js:294-324`.)

### SUBO (`WiringPanel.jsx:17`, `SUBO_PINS`/`SUBO_PIN_ORDER` `electronicsFactory.js:102-149`)

Header pins **IO1–IO21** plus **5V, GND1, GND2** (`SUBO_PIN_ORDER` = IO1..IO21 then power rails,
`electronicsFactory.js:111`). Silk header rows: Row A = `GND1,5V,IO4..IO21,GND2`, Row B = `IO1,IO2,IO3`
(`electronicsFactory.js:108-109`). ADC-capable IOs render blue/analog, plain GPIO green/digital
(`SUBO_ADC` set `electronicsFactory.js:102`): **IO1, IO5, IO8, IO11, IO12, IO17, IO19, IO20, IO21**.

**IOn → ESP32-S3 GPIO map** (`SUBO_IO_TO_GPIO`, `electronicsStore.js:146-150`; source of truth =
`Subo.h`):

| IO | GPIO | IO | GPIO | IO | GPIO |
|---|---|---|---|---|---|
| IO1 | 4 (ADC) | IO8 | 5 (ADC) | IO15 | 17 |
| IO2 | 39 | IO9 | 41 | IO16 | 18 |
| IO3 | 13 | IO10 | 40 | IO17 | 8 (ADC) |
| IO4 | 38 | IO11 | 6 (ADC) | IO18 | 11 |
| IO5 | 14 (ADC) | IO12 | 7 (ADC) | IO19 | 10 (ADC) |
| IO6 | 48 | IO13 | 15 | IO20 | 9 (ADC) |
| IO7 | 42 | IO14 | 16 | IO21 | 3 (ADC) |

**SUBO special / on-board pins** (from `Subo.h:3-9`, not in the wireable header):
- Buzzer: `SUBO_BUZZER_PIN 2`
- LED matrix: `SUBO_LED_PIN 12`, `SUBO_LED_NUM 48` (48-LED NeoPixel matrix)
- Buttons: `SUBO_BUTTONR 47`, `SUBO_BUTTONL 1`
- MotorExpansion drive pins: **Motor 1 = IO20/IO21, Motor 2 = IO19/IO18** (`WiringPanel.jsx:15-16`).

### Motors — `motor` / `motor_bo` / `motor_dc` (`MOTOR_PINS` `electronicsFactory.js:26-29`)

| Pin | Label | Type |
|---|---|---|
| TERM_A | + | power |
| TERM_B | − | gnd |

Net motor speed = TERM_A − TERM_B; swapping terminals reverses direction
(`electronicsStore.js:167,186`).

### LED (`LED_PINS` `electronicsFactory.js:31-34`)
| Pin | Label | Type |
|---|---|---|
| ANODE | + | power |
| CATHODE | − | gnd |

### Servo (`SERVO_PINS` `electronicsFactory.js:36-40`)
| Pin | Label | Type |
|---|---|---|
| SIGNAL | SIG | pwm |
| VCC | VCC | power |
| GND | GND | gnd |

### Ultrasonic HC-SR04 (`ULTRASONIC_PINS` `electronicsFactory.js:50-55`)
| Pin | Label | Type | | Pin | Label | Type |
|---|---|---|---|---|---|---|
| VCC | VCC | power | | ECHO | ECHO | digital |
| TRIG | TRIG | pwm | | GND | GND | gnd |

### IR sensor (`IR_PINS` `electronicsFactory.js:45-49`)
| Pin | Label | Type |
|---|---|---|
| OUT | OUT | digital |
| GND | GND | gnd |
| VCC | VCC | power |

### Gas sensor (`GAS_PINS` `electronicsFactory.js:66-71`)
| Pin | Label | Type |
|---|---|---|
| VCC | VCC | power |
| GND | GND | gnd |
| DO | DO | digital |
| AO | AO | analog |

### Color sensor TCS3200 (`COLOR_PINS` `electronicsFactory.js:73-81`)
| Pin | Label | Type | Function |
|---|---|---|---|
| VCC | VCC | power | |
| GND | GND | gnd | |
| S0 | S0 | digital | freq scale |
| S1 | S1 | digital | freq scale |
| S2 | S2 | digital | filter select |
| S3 | S3 | digital | filter select |
| OUT | OUT | digital | frequency out |

### LDR module (`LDR_PINS` `electronicsFactory.js:83-88`)
| Pin | Label | Type |
|---|---|---|
| VCC | VCC | power |
| GND | GND | gnd |
| AO | AO | analog |
| DO | DO | digital |

### DHT11 (`DHT11_PINS` `electronicsFactory.js:90-94`)
| Pin | Label | Type |
|---|---|---|
| VCC | VCC | power |
| GND | GND | gnd |
| DATA | DATA | digital |

### Buzzer (`BUZZER_PINS` `electronicsFactory.js:56-59`)
| Pin | Label | Type |
|---|---|---|
| SIGNAL | I/O | pwm |
| GND | GND | gnd |

### OLED I²C (`OLED_PINS` `electronicsFactory.js:60-65`)
| Pin | Label | Type |
|---|---|---|
| GND | GND | gnd |
| VCC | VCC | power |
| SCL | SCL | digital |
| SDA | SDA | digital |

Pin spheres rendered at radius `0.17` default (`PIN_SPHERE_R`, `electronicsFactory.js:169`;
SUBO uses `0.11`, `electronicsFactory.js:119`), with canvas-texture label sprites
(`createPinLabelSprite` `electronicsFactory.js:182-212`).

---

## 4. Genuine Arduino Libraries (`src/arduino/libraries/*`)

These are real, shippable Arduino sources (the "source of truth" the simulator mirrors).

### Subo — `Subo.h` (`libraries/Subo/Subo.h`)

Constants (`Subo.h:3-31`): `SUBO_BUZZER_PIN 2`, `SUBO_LED_PIN 12`, `SUBO_LED_NUM 48`,
`SUBO_BUTTONR 47`, `SUBO_BUTTONL 1`, and `IO1`–`IO21` GPIO `#define`s (ADC-marked: IO1, IO5, IO8,
IO11, IO12, IO17, IO19, IO20, IO21).

Public functions (`Subo.h:38-91`):
| Function | Purpose |
|---|---|
| `void SuboMatrixInit()` | initialize the LED matrix |
| `void setAllLED(int r, int g, int b)` | fill whole matrix |
| `void setSingleLED(int n, int r, int g, int b)` | set LED #n |
| `void playLEDSeq(int ID)` | play a preset LED sequence |
| `void stripclear()` | clear matrix |
| `void playTone(float f, float dur)` | play frequency `f` for `dur` seconds on buzzer |
| `void stopBuzzer()` | stop buzzer |
| `void playBuzSeq(int id)` | play preset buzzer sequence |

### Subo — `MotorExpansion.h` (`libraries/Subo/MotorExpansion.h`)
| Function | Purpose |
|---|---|
| `void start_motors()` | setup motor expansion (`:9`) |
| `void drive_motors(int M1A, int M1B, int M2A, int M2B)` | 4 PWM channels 0–255 (`:19`) |
| `void runMotor(String dir, int speed)` | dir = F/B/L/R/S, speed 0–255 (`:27`) |

### Subo — `pitches.h` (`libraries/Subo/pitches.h`)
Standard tone-frequency `#define`s `NOTE_B0`(31) … `NOTE_DS8`(4978) plus `REST 0`
(`pitches.h:8-99`) — 8 octaves, used by `playTone(NOTE_C5, …)` melody sketches.

### LDR — `LDR.h` (`libraries/LDR/LDR.h:47-63`)
`class LDR`: `LDR(uint8_t pin)` · `void begin()` · `int read()` (0=dark..1023=bright) ·
`int readPercentage()` (0..100). Header docstring documents wiring VCC/GND/AO(analog)/DO(digital).

### DHT11 — `DHT11.h` (`libraries/DHT11/DHT11.h:46-62`)
`class DHT11`: `DHT11(uint8_t pin)` · `void begin()` · `float readTemperature()` (°C) ·
`float readHumidity()` (%RH). One-wire DATA pin; range 0–50 °C / 20–90 %RH.

### ColorSensor — `ColorSensor.h` (`libraries/ColorSensor/ColorSensor.h:56-83`)
`struct RGB { int r, g, b; }`.
`class ColorSensor`: `ColorSensor(uint8_t s0, s1, s2, s3, out)` · `void begin()` ·
`RGB readRGB()` · `String readColor()` (named colour) · `int readRed()/readGreen()/readBlue()`.

Each library ships `.h` + `.cpp`; the `.cpp` files implement exactly these signatures (verified the
function set matches the headers). There are also `examples/*.ino` per library.

---

## 5. Runtime Simulator Sensor Libraries

### Injected classes — `src/arduino/sensorLibs.js`
`createSensorLibraries({ sensorMap, getStore })` (`sensorLibs.js:20`) returns `{ LDR, DHT11,
ColorSensor, RGB }` (`sensorLibs.js:67`), which `SimulationManager` injects into the sketch sandbox
exactly like the built-in `Servo` class (`SimulationManager.js:104,483`). Each class mirrors its
genuine library method-for-method:

| Class | Methods | Source |
|---|---|---|
| `LDR(pin)` | `begin()`, `read()`, `readPercentage()` | `sensorLibs.js:27-32` |
| `DHT11(pin)` | `begin()`, `readTemperature()`, `readHumidity()` | `sensorLibs.js:35-40` |
| `ColorSensor(s0,s1,s2,s3,out)` | `begin()`, `readRGB()`, `readColor()`, `readRed()/Green()/Blue()` | `sensorLibs.js:50-65` |
| `RGB(r,g,b)` | value struct (rounded) | `sensorLibs.js:43-47` |

An instance binds to the scene sensor wired to its pin via `sensorMap[pin] → {id}`
(`idForPin`, `sensorLibs.js:21-24`); `begin()` re-resolves the id.

### Reading interface — `src/arduino/sensorSim.js`
The single funnel for sensor readings — `readLDR`, `readLDRPercentage`, `readTemperature`,
`readHumidity`, `readColorRGB`, `classifyColor` (`sensorSim.js:36-83`).

**Scene-driven vs manual values:** each reader looks up a MANUAL override in
`electronicsStore.sensorValues` keyed by scene object id (`valueAt` `sensorSim.js:29`); if absent it
returns a simulated `DEFAULTS` (`sensorSim.js:19-24`: ldrRaw 512, tempC 25.0, humidity 50.0,
rgb {120,90,60}). Store-value key scheme (`sensorSim.js:11-16`): `ldr_sensor → <id>` (0–1023),
`dht11 → <id>` (°C) and `<id>:hum` (%RH), `color_sensor → <id>:rgb` ({r,g,b} 0–255).

**Wiring-correctness requirement (the key rule):** if the pin map cannot resolve the sensor
(`id == null`) the reader returns a DISCONNECTED value, NOT a default — LDR → 0, DHT →
`NaN`, color → `null` (`sensorSim.js:32-34,37,49,63`). This is what makes wrong/absent wiring
actually fail. Upstream, `buildSensorInputMap` (`electronicsStore.js:234-252`) only includes a
sensor whose output pin (`OUT/DO/AO/ECHO/SIGNAL/DATA`, `electronicsStore.js:197`) reaches an MCU
pin AND that passes `isSensorPowered` — the sensor's `VCC` must reach a supply rail (`5V/3V3/VIN/
VCC/*_V`, `isSupplyPinName` `:204`) and `GND` must reach a ground rail (`GND\d*/G/*_G`,
`isGroundPinName` `:209`). Missing power or ground → dead hardware (`electronicsStore.js:216-228`).

`classifyColor` snaps an RGB triple to the nearest of 9 named colours (Red/Green/Blue/Yellow/Cyan/
Magenta/White/Black/Orange) by squared distance (`sensorSim.js:71-83`).

### SUBO API + motor shims injected into sketches (`SimulationManager.js`)
`SuboMatrixInit`, `setAllLED`, `setSingleLED`, `playLEDSeq`, `stripclear`, `playTone`,
`stopBuzzer`, `playBuzSeq`, `start_motors`, `drive_motors`, `runMotor` are provided as JS shims
(`SimulationManager.js:31-32,371-405,480-481`); `drive_motors`/`runMotor` drive the matching motor
components. Default TCS3200 macros `S0/S1/S2/S3/OUT` are also defined so `ColorSensor color(S0,…)`
compiles unchanged (`SimulationManager.js:44,407`).

---

## 6. Wiring — UI, Data Model & 3D Wires

### Connection data model (`src/stores/electronicsStore.js`)
`electronicsStore.connections` = `{ connId → { fromPinId, toPinId } }` (`electronicsStore.js:29-31`).
A `pinId` is the string `"<componentId>:<pinName>"` (e.g. `compA:D3`). Mutators:
`addWireConnection(from,to,connId)` (`:60`), `removeWireConnection(connId)` (`:66`),
`removeConnectionsFor(componentId)` (`:74`), `setConnections` for load (`:111`).
Consumed by `buildPinToComponentMap` (`:169`), `buildSensorInputMap` (`:234`),
`buildPinToMotorMap` (`:255`), and `pinNameToNumber` (`:153`, D<n>→n, IOn→GPIO).

### WiringPanel — pin-to-pin state machine (`src/components/WiringPanel.jsx`)
A 4-state machine (`WiringPanel.jsx:92-96`): `idle` → `source` (source pin picked) →
`confirm` (dest picked, choose wire colour + Connect) → back to idle; plus `disconnect` prompt.
- Only wireable types are shown: `ELEC_TYPES` set (`WiringPanel.jsx:10`) —
  arduino, subo, motor, motor_bo, motor_dc, led, servo, ir_sensor, ultrasonic, buzzer, oled,
  gas_sensor, color_sensor, ldr_sensor, dht11. Weapons are NOT wireable.
- Pins render as a 3-column grid of `PinButton`s per component (`WiringPanel.jsx:333-351`), pin
  names from `PIN_DEFS` (`:12-31`).
- Any pin fans out freely (GND/5V to many parts); only an exact duplicate pair is rejected
  (`connect()` `WiringPanel.jsx:138-164`). Confirms via `addWireConnection` + draws a 3D wire via
  `objectManager.addWire` (`:159`), storing `fromPinId`/`toPinId` on the line for re-routing.
- 8 wire colours `WIRE_COLORS` (`WiringPanel.jsx:33`). An always-visible "Active Connections"
  list at the bottom lets you ✂ Cut individual wires (`:357-391`).
- Empty state prompts to add an Arduino/Motor/Servo/LED first (`:173-180`).

### WiringWorkbench — drag-to-connect 2D (`src/components/WiringWorkbench.jsx`)
Launched from a button inside WiringPanel — "🔌 Wiring Workbench — drag to connect"
(`WiringPanel.jsx:270-276`), opens a modal (`wbOpen` state, `:102,267`). A Fritzing-style 2D
drag-between-terminals view that shares the same `electronicsStore.connections`.

### WireManager — 3D wire tubes + pin reveal (`src/managers/WireManager.js`)
Renders 3D wire tubes and supports drag-to-connect in the viewport. **Hidden-until-needed pin
reveal**: pin spheres/labels are hidden by default so GLB boards read as real hardware
(`WireManager.js:52-56`). `setReveal({ all, components })` (`:86-88`) sets visibility; a pin is
active/raycast-targetable only when `all` is true, its component is revealed, or a wire is being
dragged (`_pinActive` `:93-94`, `_raycastPins` `:407`). `_refreshPins()` re-applies baseline
opacity (`:97`).

### App wiring of reveal (`src/App.jsx:263-270`)
```
if (activePanel === 'wiring') wireManager.setReveal({ all: true })     // all boards' pins
else if (selectedId)         wireManager.setReveal({ components: [selectedId] })  // just selected
else                         wireManager.setReveal({ components: [] })  // none
```
So pins appear only while the Wiring panel is open (every board) or a board is selected (that board).

---

## 7. Where Each Thing Lives in the UI

The app is viewport-first with a right icon-rail workspace (one section at a time), driven by
`App.jsx`.

- **Electronics creation → "Create" group → `Electronics` section** rendered by
  `ElectronicsLibrary.jsx`. Navigate: right icon-rail → Create group → Electronics (the 🧠 MCUs /
  📡 Sensors / 📺 Displays / ⚙ Actuators / ⚔ Weapons accordions). Clicking a part adds it at the
  scene origin via `addObject(type)`.
- **Wiring → "Build" group → `Wiring` section** (`App.jsx:466-467,491`), id `wiring`, icon `zap`,
  rendered by `WiringPanel.jsx`. Opening it also flips every board's pins visible (the
  `setReveal({all:true})` effect above). The Workbench modal launches from inside this panel.
- Selecting a board in the viewport (without opening Wiring) reveals just that board's pins.
- Weapons created here are combat parts for the Physics Arena (Run → Battle → Physics Arena), not
  wireable in the Wiring panel.


---

# Part 2 — Code Editor, Compiler Diagnostics & Execution

_The Code panel, compiler diagnostics, the C++→JS transpiler, and the exact execution lifecycle & timing._

This section documents the full "write code → compile-check → run" pipeline for Constructa/Imaginarium: the text **Code** panel, the visual **Blocks** panel, the pre-flight **compiler diagnostics**, the Arduino C++ **parser/transpiler**, and the runtime **execution + timing model**.

All five stages share the same downstream machinery: both the Code editor and the Blockly editor feed C++ text through the **same** `analyzeArduino()` diagnostics gate and then the **same** `parseAndTranspile()` + `SimulationManager.start()` runtime.

Files covered:
- `src/components/CodeEditor.jsx`
- `src/components/CompilerOutput.jsx`
- `src/components/BlocksPanel.jsx`
- `src/utils/arduinoDiagnostics.js`
- `src/utils/arduinoParser.js`
- `src/managers/SimulationManager.js`
- `src/blockly/arduinoBlocks.js`
- `src/blockly/arduinoGenerator.js`

---

## 1. The Code panel — `src/components/CodeEditor.jsx`

**UI location:** the right icon-rail **Program → Code** section (`activePanel === 'code'`). It is a full-height panel: header (title + Templates dropdown + running indicator) → prerequisite hints → code `<textarea>` → Run/Stop button → `CompilerOutput` → runtime-error box → live motor/servo meters → serial monitor.

The editor's `code` string is stored in `electronicsStore` (`useElectronicsStore((s)=>s.code)` / `setCode`); it is not local component state, so the Blockly panel's "To Code" button and templates both mutate the same shared source (`CodeEditor.jsx:163-164`).

### 1.1 The Run flow — WHEN code executes and the compile gate

`handleRun()` (`CodeEditor.jsx:228-262`) runs when the green **Run** button is clicked. Exact sequence:

1. Clear prior runtime error + serial log; `trackEvent('code_run', { parts: objects.length })` (`:229-231`).
2. **Pre-flight compile pass — BEFORE running.** Board is chosen `hasSubo ? 'subo' : 'arduino'` (`:234`). Then `const report = analyzeArduino(code, { board })` (`:235`) and `setDiag(report)` renders the compiler panel.
3. **Error gate:** `if (!report.ok) return` (`:237`). If the analyzer found any blocking **errors**, execution is *withheld entirely* — the simulation never starts, only the red compiler report shows. (A sketch with zero errors — warnings are non-blocking — proceeds.)
4. `simulationManager.configure(...)` wires the callbacks (`:239-252`): `connections`, `objects`, `setMotorSpeed`, a runtime-error handler that also calls `stopSimulation()`, a serial-out handler (appends to `serialLog`, clamped to the last 4000 chars, `:245-248`), an LED handler → `objectManager.animateLed`, and a servo handler → `setServoAngle`.
5. `const err = simulationManager.start(code)` (`:254`) transpiles and launches. `start()` returns `null` on success or `{ error }` on transpile failure.
6. **Transpiler safety-net:** if `start()` returns an error even though diagnostics passed (should be rare), it is surfaced through the **same** `CompilerOutput` panel as a single synthetic `kind:'transpile'` error diagnostic (`:255-258`). Otherwise `startSimulation()` flips the store's `simulation.running` flag (`:260`).

So: **code executes only after diagnostics report `ok:true`, and only if the transpiler also succeeds.**

Editing the textarea clears any stale diagnostics: `onChange={... if (diag) setDiag(null)}` (`:328`).

### 1.2 Run enabled/disabled conditions

The Run button `disabled` expression (`CodeEditor.jsx:346`):
```
disabled={!hasArduino || !hasControllable || (!hasConnections && !hasSubo)}
```
Derived flags (`:200-208`):
- `hasArduino` = scene has an object of type `arduino` or `subo`.
- `hasControllable` = scene has any object whose type is in `CONTROLLABLE`.
- `hasConnections` = `electronicsStore.connections` non-empty.
- `hasSubo` = scene has a `subo` board (SUBO has on-board matrix/buzzer/buttons that run with **no wiring**, so a SUBO alone is runnable — the `!hasSubo` clause exempts it from the connection requirement).

`CONTROLLABLE` list (`:199`): `['motor', 'motor_bo', 'motor_dc', 'led', 'servo', 'ir_sensor', 'ultrasonic', 'buzzer', 'oled', 'gas_sensor', 'color_sensor', 'ldr_sensor', 'dht11', 'subo']`. Sensors are included so sensor-only reader sketches (LDR/DHT11/ColorSensor) are runnable, not just actuator sketches.

Prerequisite hints (`:271-273`, rendered `:314-322`): `noArduino` → "Add an Arduino or SUBO board"; `noComponent` → "Add an electronics component…"; `noConnection` (`hasArduino && hasControllable && !hasConnections && !hasSubo`) → "Draw a wire from an Arduino pin to the component".

### 1.3 Templates list (Templates ▾ dropdown)

Defined in the `TEMPLATES` array (`CodeEditor.jsx:10-160`). Clicking a label sets the shared code via `setCode(t.code)` (`:299`). Every template:

| Label | What it does |
|---|---|
| **Motor ramp** | `analogWrite(pin3, 220/80/0)` with delays — ramps a motor (TERM_A→pin 3, TERM_B→GND) through speeds. |
| **Legged: walk** | Demonstrates the legged locomotion API: `walk(80)`, `turn(60)`, `walk(-60)`, `stopWalking()` — steer a legged robot; the gait engine moves the legs. |
| **Servo sweep** | `#include <Servo.h>`; `myServo.attach(9)`; two `for` loops sweeping 0→180→0 in 5° steps with `delay(30)`. |
| **LED blink** | `analogWrite(ledPin,200/0)` with 500 ms delays. |
| **SUBO: LED matrix** | `#include <Subo.h>`; `SuboMatrixInit()`; `setAllLED(0,128,0)`, `setSingleLED(1,128,0,0)`, `playLEDSeq(2)`, `stripclear()`. |
| **SUBO: Buzzer** | `playTone(NOTE_C5, 0.2)` (note the **duration is in seconds**), then E5/G5, then `playBuzSeq(1)`. |
| **SUBO: Motors** | `#include <MotorExpansion.h>`; `start_motors()`; `runMotor("F"/"L"/"S", speed)`. |
| **SUBO: Button** | `pinMode(SUBO_BUTTONL, INPUT_PULLUP)`; reads `digitalRead(SUBO_BUTTONL)==LOW` (active-low) to light the matrix red while held. |

### 1.4 Jump-to-error behavior

`jumpTo(line, col)` (`CodeEditor.jsx:211-226`), passed to `<CompilerOutput onJump={jumpTo}>` (`:355`). It computes the char offset for the start of `line`, then:
- Focuses the textarea, `setSelectionRange(start, start+lineText.length)` to **highlight the whole offending line** (`:220`).
- Approximates scroll: `scrollTop = (line-1) * lineHeight - clientHeight/2` (centres the line, `:222-223`).
- On the next `requestAnimationFrame`, re-places the caret at the exact column (`:225`).

### 1.5 Serial log, meters, Stop

- **Serial monitor:** rendered only while running or when non-empty (`:406`). Appended via the serial-out callback; clamped to the last 4000 chars (`:245-248`); auto-scrolls to bottom on change (`:181-183`); has a Clear button.
- **Live meters** (only while `simulation.running`, `:366-403`): motor bars width `= |speed|/255*100%`; servo bars `= angle/180*100%` with a degree readout. Data comes from `simulation.motorSpeeds` / `simulation.servoAngles`.
- **Stop** (`handleStop`, `:264-269`): `simulationManager.stop()` → `objectManager.resetAllLeds()` → `stopSimulation()` → clear runtime error.

---

## 2. Compiler diagnostics — `src/utils/arduinoDiagnostics.js` + `src/components/CompilerOutput.jsx`

### 2.1 Contract & design

`analyzeArduino(src, { board='arduino' })` returns (`arduinoDiagnostics.js:194`, doc `:15-20`, `:462`):
```
{ ok, errors:[Diag], warnings:[Diag],
  stats:{ lines, functions, variables, libraries, warnings, timeMs } }
```
`Diag = { severity, kind, line, col, endCol, len, file:'sketch.ino', message, explain, suggestion, snippet, caret }`.

It is **side-effect free and additive** — it never touches `arduinoParser` or `SimulationManager` (`:5-9`). **Design priority: precision over recall** — every ERROR must be an unambiguous mistake; anything uncertain is a non-blocking WARNING (`:11-13`). `ok = errors.length === 0` (`:462`), so only errors gate execution.

### 2.2 Its own tokenizer

`tokenize(src, lexErrors)` (`:67-159`) is a **separate** tokenizer from the parser's lexer, tracking line + column + source index + length per token. Token types `T = {NUM, STR, CHAR, IDENT, OP, PUNCT, PP, ERR, EOF}` (`:65`). Unlike the parser (which throws on the first error), this collects **multiple** lexical errors in one pass into `lexErrors`.

### 2.3 Every ERROR type (blocking)

**Lexical errors** (produced by the tokenizer, emitted `:211-220`):
- `unterminated-string` — `"` opened, never closed on the line (`:99-101`, `:214`).
- `unterminated-char` — `'` not closed (`:109-111`, `:215`).
- `empty-char` — `''` with no character (`:112`, `:216`).
- `unterminated-comment` — `/* ...` never closed with `*/` (`:83`, `:217`).
- `invalid-number` — bad numeric literal, e.g. a stray letter touching digits (`12abc`) or a second decimal point (`:120-135`, `:218`).
- `stray-char` — a character not valid in C++ here (`:155`, `:219`).

**Bracket-balance errors** (`:281-305`):
- `unmatched-bracket` — a closing `)`/`]`/`}` with no opener (`:296`).
- `mismatched-bracket` — an opener closed by the wrong bracket type (`:298`).
- `missing-bracket` — an opener never closed (leftover on the stack, `:303-305`).

`{` braces are classified `'block'` vs `'init'` (initializer) so missing-semicolon detection is skipped inside initializer braces (`:287-291`).

**Missing-semicolon errors** (high-precision, `:307-335`):
- `missing-semicolon` — fires only at paren-depth 0, inside a `'block'` brace, when an expression-ending token (`isExprEnd`) is directly followed by either a block-closing `}` (Case A, `:327-329`) or a token that starts a **new statement on a later line** (Case B, `:332-334`). Never inside `(...)` or an initializer `{...}`.

**Semantic errors** (`:337-402`):
- `board-mismatch` — a SUBO API function/constant used when `board==='arduino'` and no `#include <Subo.h>` (`:351-356`). Suggests `#include <Subo.h>`.
- `invalid-pin` — an `IOn` constant with `n < 1 || n > 21` (SUBO only exposes IO1–IO21, `:359-366`).
- `unknown-function` — a call `name(` whose name is not in the core, SUBO library, or the sketch (`known()` check). Attaches a "did you mean" suggestion (`:369-372`).
- `unknown-identifier` — a **non-call** identifier that's unknown — but flagged **only** when there is a strong suggestion (`caseOnly`, i.e. differs only in case; or `nearMiss`, Levenshtein ≤ 2 and length diff ≤ 2), so genuine untracked user variables are never falsely reported (`:377-385`).
- `duplicate-function` — a second definition of an already-declared function name (`:241`).
- `arg-count` — a core/SUBO builtin called with the wrong argument count vs its fixed arity (`:388-395`). Arities come from `CORE_FUNCS` (`:26-33`) and `SUBO_FUNCS` (`:35-39`); `null` arity = variadic/not enforced (e.g. `random`, `tone`, `pulseIn`, `drive_motors`).
- `type-mismatch` — `digitalWrite`'s 2nd argument is a string literal instead of HIGH/LOW (`:397-400`).
- `invalid-include` — an unknown `#include` whose base name is within Levenshtein 2 of a `KNOWN_LIBS` entry → error with a "did you mean" (`:442-444`). (Unknown includes with no close match become the *warning* `unknown-include`.)

The synthetic `transpile` kind (from `CodeEditor.jsx:258`) is also rendered as an error even though it isn't produced by the analyzer.

### 2.4 Every WARNING type (non-blocking)

Section 6 (`:404-448`):
- `assign-in-condition` — `if (x = ...)` / `while (x = ...)` using single `=` (`:406-412`). "Did you mean `==`?"
- `div-zero` — division/modulo by a literal `0` (`:414-418`).
- `always-true` — `if (true)` / `if (<nonzero-number>)` (`:420-426`).
- `infinite-loop` — `while(true)` / `while(1)` / `for(;;)` whose body contains no `break`/`return` (`flagInfiniteLoops`, `:428`, `:522-542`).
- `dead-code` — statements after `return`/`break`/`continue` before the block closes (`flagDeadCode`, `:430`, `:544-557`).
- `unused-variable` — a tracked user variable referenced only once (its declaration) (`:432-435`).
- `unknown-include` — an `#include` not in `KNOWN_LIBS` and not a near-miss of one (`:445`).

### 2.5 "Did you mean" suggestion engine (Levenshtein)

`levenshtein(a,b)` (`:162-176`) is a standard O(mn) edit-distance with a rolling 1-D array. `suggest(name, dict)` (`:179-191`):
1. **First** prefers a **case-insensitive exact hit** (highest-confidence typo, e.g. `pinmode`→`pinMode`, `:181-183`).
2. Else the nearest dictionary entry within an **edit budget** = `clamp(floor(name.length * 0.34), 1, 3)` (`:184-190`).

The suggestion `dict` (`:273-276`) is the union of `CORE_FUNCS`, `SUBO_FUNCS`, `CORE_CONSTS`, `SUBO_CONSTS`, `LIB_CLASSES`, `Serial`/`Wire`/`setup`/`loop`, plus the sketch's own `userFuncs`, `userVars`, and `#define`s. Note-constants are matched by regex `isNoteConst` (`^NOTE_[A-G]S?[0-8]$` or `REST`, `:54`).

### 2.6 Symbol dictionaries & the `known()` check

- `CORE_FUNCS` (`:26-33`): pinMode(2), digitalWrite(2), digitalRead(1), analogWrite(2), analogRead(1), delay(1), delayMicroseconds(1), millis(0), micros(0), map(5), constrain(3), min(2), max(2), abs(1), sq(1), sqrt(1), pow(2), floor/ceil/round/log/exp/sin/cos/tan(1), random(null), randomSeed(1), tone(null), noTone(1), pulseIn(null), bitRead(2), bitWrite(3), bitSet(2), bitClear(2), lowByte(1), highByte(1).
- `SUBO_FUNCS` (`:35-39`): SuboMatrixInit(0), setAllLED(3), setSingleLED(4), playLEDSeq(1), stripclear(0), playTone(2), stopBuzzer(0), playBuzSeq(1), start_motors(0), drive_motors(null), runMotor(2).
- `CORE_CONSTS` (`:41-48`), `SUBO_CONSTS` (`:49-52`, IO1–IO21 + SUBO_BUZZER_PIN/LED_PIN/LED_NUM/BUTTONR/BUTTONL), `LIB_CLASSES` (`:56`: Servo, LDR, DHT11, ColorSensor, RGB, Adafruit_SSD1306, String), `KNOWN_LIBS` (`:58`).
- `known(name)` (`:265-270`) is true for any core func/const, SUBO func/const, note const, lib class, C type, control keyword, decl keyword, user func/var/type, `#define`, or `Serial`/`Wire`/`setup`/`loop`.

Symbol collection (`:222-263`): includes/defines from `#` preprocessor tokens; function definitions detected as `TYPE name (` at statement start; variable declarations as `TYPE name` (incl. for-loop/param locals `( TYPE IDENT` and `, TYPE IDENT`).

### 2.7 Stats & the success report

`stats` (`:454-461`): `lines` (source line count), `functions` (`userFuncs.size`), `variables` (`userVars.size`), `libraries` (`includes.size`), `warnings` (count), `timeMs` (analysis time via `performance.now()`, rounded to 0.1 ms). Errors and warnings are sorted by line then column (`:452-453`).

### 2.8 `CompilerOutput.jsx` rendering

Purely presentational, reused by both editors (`CompilerOutput.jsx:12`). `<CompilerOutput result={diag} onJump={...}>`; renders `null` if no result (`:81`).

- **Header:** if `errors.length>0` → red "✕ Compilation failed — N errors · M warnings" (`:87-91`). Else → a green box "✓ Compilation Successful / Ready to Execute ▶" plus a **stats row** of `<Stat>` tiles: Lines, Functions, Variables, Libraries, Warnings, Time (ms) (`:92-108`).
- **Diagnostic cards** (`DiagCard`, `:29-69`): errors first, then warnings (`:111-112`). Each card: severity icon (✕ red / ⚠ amber), a **kind→human title** via `KIND_TITLE` map (`:15-27`, e.g. `missing-semicolon`→"Syntax Error", `board-mismatch`→"Board Error", `unknown-function`→"Undeclared Identifier"), a clickable `file:line:col` link calling `onJump(line, col)` (`:41-47`), the message, a **code snippet with a `^` caret** rendered on the line below the source (`caret` field, gutter = `"<line> | "`, `:55-60`), a 💡 suggestion line (`:61-63`), and an expandable "▸ details" explanation (`:48-52`, `:64-66`).
- Panel scrolls at `maxHeight: 260` (`:86`).

---

## 3. The parser/transpiler — `src/utils/arduinoParser.js`

`parseAndTranspile(src, skipDefines)` (`:789-799`) is the runtime transpiler (distinct from the diagnostics analyzer). Pipeline: **lex → recursive-descent parse → JS code-gen**. Returns `{ code, error }`; a thrown `SyntaxError` becomes `{ code:null, error }` (`:796-798`).

### 3.1 Lexer

`lex(src)` (`:26-122`) produces tokens `TT = {NUM, STR, CHAR, IDENT, KW, OP, PUNCT, PP, EOF}` (`:6`). Handles `//` and `/* */` comments, `#`-preprocessor lines (kept whole as `PP`), string/char literals with escape decoding via `ESC` (`:22`), decimal/hex(`0x`)/binary(`0b`)/float/exponent numbers with `_` separators and `uUlLfF` suffixes stripped, and multi-char operators (longest-match: `<<=`/`>>=`, then 2-char ops, then single). `KEYWORDS` set (`:8-15`) marks type/control/constant keywords as `KW`.

### 3.2 Parser (recursive descent)

`class Parser` (`:189-596`) over a `TS` token-stream wrapper (`:126-145`).

- **Pre-scan** (`_preScan`, `:197-204`): collects every user function name up front (pattern `TYPE IDENT (`) into `userFuncs` — needed so the code-gen can inject `await` at **all** user-function call sites, even forward references.
- **Top level** (`:216-222`): preprocessor, `struct`/`typedef` (skipped via `_skipBraced`), declarations/functions, or expression statements.
- **Declarations vs functions** (`parseDeclOrFn`, `:233-243`): `TYPE name(` where `TYPE` is a class (`isClassType`, `:182-185`, PascalCase & not a C type/Arduino constant) → **object construction** (`Servo`/`LDR`/`DHT11`/`ColorSensor`); otherwise a function. `#define NAME value` → `Define` node (`:224-231`).
- **Statements** (`:351-483`): if/while/for/do-while/switch-case/return/break/continue, blocks, variable declarations, and expression statements.
- **Expressions** (`:485-595`): a full precedence ladder — assignment → ternary → `||` → `&&` → `|` → `^` → `&` → equality → relational → shift → additive → multiplicative → unary/cast → postfix (index/call/member/`++`/`--`) → primary. `sizeof` is parsed and collapsed to `1` (`:585-589`).

### 3.3 Code generator (`Gen`) — how setup()/loop() are transformed

`class Gen` (`:609-785`) emits JS text. Key transforms:

- **Every C function becomes an `async function`** (`gFn`, `:654-661`): `void setup(){...}` → `async function setup(){...}`; `void loop(){...}` → `async function loop(){...}`. Function **calls** get `await` injected when the callee is an async builtin (`ASYNC_BUILTINS = {delay, delayMicroseconds}`, `:600`) **or** a user function (`this.uf.has(cname)`, `:771-780`). This is why `delay()` and any nested user-function call correctly suspend execution.
- **Object construction:** `Servo myServo;` → `let myServo = new Servo()` (via `_defInit`, `:686-696`); `LDR ldr(A0);` → `let ldr = new LDR(A0)` (via `ctorArgs`, `:678-681`).
- **Type casts** map to JS (`CASTS`, `:602-607`): `(int)x`→`Math.trunc(x)`, `(byte)x`→`(v=>v&0xFF)(x)`, `(unsigned long)x`→`(v=>v>>>0)(x)`, `(float)`→`Number`, `(char)`→`String.fromCharCode`, etc.
- **`const` vs `let`** chosen per declaration (`:664`); arrays fill with type-appropriate defaults (`:665-676`).
- `#define` becomes `const NAME = value` unless the name is in `skipDefines` or is function-like (`gDefine`, `:637-643`).

Note: `setup`/`loop` are **not** called by the generated code itself — the driving `while(true)` loop is appended by `SimulationManager` (see §4).

### 3.4 Board-agnostic pin mapping (D<n> / IO<n> → GPIO)

The parser has **no** hard-coded pin knowledge — pin identifiers are just numbers or constants that flow through as JS. The board-agnosticism lives at runtime: `SimulationManager` prepends `SUBO_CONSTS` (`SimulationManager.js:405`) that defines `IO1..IO21` and `A0..A7` as their GPIO numbers (e.g. `IO3=13`, `IO21=3`, `A0=14`), so `digitalWrite(IO3, HIGH)` resolves `IO3`→13 and hits the same pin-to-component map as `digitalWrite(3, HIGH)`. This is why SUBO reuses the Arduino parser unchanged.

### 3.5 Sandboxing

The transpiled JS is executed inside a `new Function(...)` in **strict mode** (`SimulationManager.js:451-472`) whose parameters are exactly the whitelisted Arduino/SUBO/sensor API functions — no `window`, `document`, `eval`, or store access is passed in. The body is wrapped in `"use strict"; return (async () => { try {...} catch {...} })()`. Everything the sketch can touch is a closure variable provided by `SimulationManager`.

---

## 4. Execution model + TIMING — `src/managers/SimulationManager.js`

Singleton `simulationManager` (`:517`). This is the crux of the runtime timing.

### 4.1 Lifecycle — the exact loop cadence

`start(code)` (`:89-493`) builds the sandbox and assembles the driving script (`:437-447`):
```js
${SUBO_CONSTS}
${SENSOR_CONSTS}
${SUBO_NOTE_DEFS}
${jsCode}
if (typeof setup === 'function') await setup();   // ← setup() runs ONCE
while (true) {
  if (typeof loop === 'function') await loop();    // ← loop() runs REPEATEDLY
  await __yield();                                 // ← yield to browser each iteration
}
```

So the model is: **`setup()` runs exactly once, then `loop()` runs repeatedly in an infinite `while(true)`**, with an `await __yield()` between iterations. The whole thing is an async IIFE; `.then(() => { self._running = false })` clears the flag when the loop is ever exited (only via `stop()` throwing `'stopped'`) (`:485`).

### 4.2 `delay(ms)` — setTimeout, minimum 1 ms

`delay` (`:111-116`):
```js
const delay = (ms) => new Promise((resolve, reject) => {
  if (!self._running) { reject(new Error('stopped')); return }
  const id = setTimeout(resolve, Math.max(1, Number(ms) || 0))
  self._cancelDelay = () => { clearTimeout(id); reject(new Error('stopped')) }
})
```
- Backed by a real `setTimeout`; the requested ms is clamped to a **minimum of 1 ms** (`Math.max(1, ...)`), and non-numeric/NaN falls to 0→1. `delay(0)` therefore sleeps ~1 ms, not 0.
- If already stopped, it rejects `'stopped'` immediately.
- It stores `self._cancelDelay` so a mid-delay `stop()` can clear the pending timer and reject.
- Because the generator `await`s every `delay()` call (§3.3), the async loop truly suspends for the timeout duration. `delayMicroseconds()` is a no-op (`:244`) — sub-ms is effectively instant.

### 4.3 `__yield()` — one setTimeout(0) per loop iteration, and WHY

`__yield` (`:121-126`):
```js
const __yield = () => new Promise((resolve, reject) => {
  if (!self._running) { reject(new Error('stopped')); return }
  const id = setTimeout(resolve, 0)
  self._cancelDelay = () => { clearTimeout(id); reject(new Error('stopped')) }
})
```
Injected once per loop iteration (the `await __yield()` at the bottom of the `while(true)`). **Why:** a `loop()` that never calls `delay()` (trivially easy to build with blocks) would otherwise spin forever synchronously on the main thread and hard-freeze the page (`:118-120`). The `setTimeout(0)` hands control back to the browser each pass (letting the render loop, input, and React run) and gives `stop()` a suspension point to interrupt. So the effective **minimum cadence of a delay-free `loop()` is one macrotask (~0 ms + browser clamping) per iteration**.

### 4.4 `stop()` — interrupt via reject('stopped')

`stop()` (`:495-512`) and interruption: it sets `_running=false`, silences the buzzer oscillator, blanks OLED screens and the SUBO matrix, clears LED/motor/servo output maps, and calls `this._cancelDelay()` — which `clearTimeout`s the pending `delay`/`__yield` timer and **rejects the promise with `new Error('stopped')`** (`:508-511`). That rejection unwinds the awaited chain up to the sandbox's `try/catch`, which **swallows `'stopped'` specifically** (`:466`) so it isn't reported as a runtime error; any *other* thrown error is formatted and passed to `onRuntimeError` (`:465-469`, `:331-336`). `start()` also calls `this.stop()` first thing (`:90`) so a re-run cleanly kills a prior run.

### 4.5 Every API shim provided to the sketch

Passed as `new Function` parameters (`:451-484`). Grouped:

**Digital/analog I/O** (`:128-170`):
- `analogWrite(pin,val)` / `digitalWrite(pin,val)` route through `_write(pin, val, isDigital)`. Raw value is clamped 0–255 (digital → 0 or 255). For each connected component on that pin: motors update a terminal, LEDs set brightness, servos map 0–255→0–180°, buzzers beep ~2 kHz when >0.
- `pinMode` = no-op (`:170`).
- `digitalRead(pin)` (`:214-230`): sensor-aware (IR→0/1, gas DO threshold at >512) plus SUBO on-board buttons (GPIO 47=right, 1=left; idle HIGH=1, pressed LOW=0, active-low pull-up).
- `analogRead(pin)` (`:231-237`): reads the wired sensor, clamped 0–1023 (IR→0/1023).
- `pulseIn(pin)` (`:239-243`): for HC-SR04 ultrasonic returns echo width µs = `reading*58` (so `distance_cm = pulseIn/58`).

**Timing / math** (`:302-323`): `millis()` = `performance.now()`; `micros()` = `performance.now()*1000`; `map(v,il,ih,ol,oh)` linear remap; `constrain(v,lo,hi)`; plus `abs,min,max,sq,sqrt,pow,floor,ceil,round,log,exp,sin,cos,tan,random,randomSeed`. `HIGH=1,LOW=0,OUTPUT=1,INPUT=0` (`:301`).

**Serial** (`:324-329`): `Serial.begin/print/println/write` — print/write forward to `onSerialOut`; println appends `\n`.

**Buzzer / tone** (Web Audio, `:247-271`): `_beep(freq,durSec)` creates a square-wave oscillator (clamped 20–8000 Hz, gain 0.04); `tone(pin,freq,dur)` (dur in **ms**→sec) and `noTone(pin)`. Auto-resumes a suspended AudioContext.

**Servo class** (`:341-359`): `Servo` with `attach(pin)`, `write(angle)` (clamped 0–180, pushes to `servoAngles` + `onServoAngle`), `writeMicroseconds` (500–2500 µs → 0–180°), `read`, `attached`, `detach`. `Servo myServo;` transpiles to `new Servo()`.

**OLED / I2C** (`:276-299`): an `Adafruit_SSD1306` class buffering `print/println/write` and flushing on `display()` to every scene OLED via `objectManager.setOledScreen`; `width()=128,height()=64`. A stub `Wire` I2C object.

**SUBO API** (`:361-401`):
- `SuboMatrixInit()` / `stripclear()` → clear the on-board 48-LED matrix; `setAllLED(r,g,b)`, `setSingleLED(n,r,g,b)`, `playLEDSeq(id)` drive every SUBO board's 3D matrix via `objectManager.setSuboMatrix`.
- `playTone(f, durSec)` — real Web-Audio tone, **duration in SECONDS** (`:377-380`); `stopBuzzer()`; `playBuzSeq(id)` plays a built-in melody (ids 1–5) as scheduled `setTimeout` beeps 190 ms apart (`:382-391`).
- `start_motors()` = no-op; `drive_motors(m1a,m1b,m2a,m2b)` and `runMotor(dir,speed)` map to motor-expansion GPIO pins (M1A=9, M1B=3, M2A=10, M2B=11) via `_mexSet`→`_write` (`:364-401`). `runMotor` directions: `F`=(s,0,s,0), `B`=(0,s,0,s), `L`=(s,0,0,s), `R`=(0,s,s,0), else stop.
- Note constants `NOTE_*` come from `SUBO_NOTES` (`:10-19`), emitted as `SUBO_NOTE_DEFS` (`:414`), mirroring `pitches.h`.

**Sensor libraries** (`:104-107`): `LDR, DHT11, ColorSensor, RGB` classes from `createSensorLibraries({sensorMap, getStore})` (`src/arduino/sensorLibs.js`), bound to the scene sensor wired to each instance's pin.

**Legged locomotion API** (`:172-193`): `walk(speed)`, `turn(rate)`, `stopWalking()` — the "just walk it" path. `speed`/`rate` are clamped −100..100 (%) then scaled:
- `walk(p%)` → `leggedDrive.speed = p/100 * LEGGED_CODE_MAX_SPEED` where `LEGGED_CODE_MAX_SPEED=8` scene-units/s (`:177,180-181`).
- `turn(p%)` → `leggedDrive.turn = p/100 * LEGGED_CODE_MAX_TURN` where `LEGGED_CODE_MAX_TURN=1.8` rad/s (`:178,184-186`).
- Any call sets `_leggedCmd=true`, which is the signal for the gait engine (`DriveManager`) to translate the body instead of skipping it (`:68-74`). Reset each run (`:92-94`).

### 4.6 Output channels — ranges/units

- `motorSpeeds` (`:64`): `motorId → signed speed −255…+255`. Units = raw PWM magnitude difference.
- `servoAngles` (`:67`): `servoId → angle 0–180°`.
- `ledBrightness` (`:66`): `ledId → 0–255`.
- `leggedDrive` (`:73`): `{ speed (scene-units/s, ±8 max), turn (rad/s, ±1.8 max) }`, matching `DrivePanel` LEGGED_SPEED/LEGGED_TURN so `DriveManager` uses them interchangeably.

### 4.7 Motor terminal A−B → signed speed

In `_write` (`:138-151`), each motor keeps `_motorTerminals[id] = {A, B}`. Writing a pin updates the terminal that pin is wired to (`comp.terminal`, default `'A'`). **Net speed = A − B** (range −255…+255), so:
- TERM_A→PWM pin, TERM_B→GND (B=0) gives `net = A` (forward).
- Swapping so TERM_B carries the PWM reverses sign (motor spins backward).
- If **both** terminals are wired to the same driven pin (`A!==0 && B!==0 && net===0`), it warns that speed is 0 and to wire TERM_B to GND (`:148-149`).
The net is stored in `motorSpeeds[id]` and pushed via `onMotorSpeed` (`:150-151`).

### 4.8 Setup wiring & the `BUILTIN_NAMES` guard

Before parsing, `start()` builds `pinMap` (`buildPinToComponentMap`) and `sensorMap` (`buildSensorInputMap`) from the connections/objects (`:96-97`), logs the wiring, and warns about unpowered sensors (`:418-430`). `parseAndTranspile(code, BUILTIN_NAMES)` is called with `BUILTIN_NAMES` (`:23-47`) as `skipDefines` — so a user `#define` that collides with an injected closure name (e.g. `A0`, `IO3`, `HIGH`) is skipped rather than emitted as a `const`, avoiding "Identifier already declared" in strict mode (`:20-22`). If the transpiler returns an error, `start()` returns `{ error: 'Parse error: ' + parseErr }` (`:432-435`).

---

## 5. Blockly path — `arduinoBlocks.js` + `arduinoGenerator.js` + `BlocksPanel.jsx`

**UI location:** right icon-rail **Program → Blocks** section. Lazy-loaded — a "Load Block Editor" button gates the ~700 KB Blockly injection behind a click (`BlocksPanel.jsx:191-208`, `started` flag).

### 5.1 Blocks & toolbox (`arduinoBlocks.js`)

`defineArduinoBlocks()` registers `CUSTOM_BLOCKS` once (`:180-185`). Custom hardware blocks (`:20-178`): `arduino_setup_loop` (the required top container with `setup` + `loop forever` statement inputs), `arduino_pinmode`, `arduino_digitalwrite`, `arduino_digitalread`, `arduino_analogwrite`, `arduino_analogread`, `arduino_delay`, `arduino_serial_begin`, `arduino_serial_print`, `arduino_servo_attach`, `arduino_servo_write`, `arduino_read_ldr`, `arduino_dht_temperature`, `arduino_dht_humidity`, `arduino_read_color`, and SUBO blocks `subo_matrix_init` / `subo_set_all_led` / `subo_play_tone` / `subo_run_motor`. Pin fields default range 0–19 (`:16-18`). `ARDUINO_TOOLBOX` (`:188-301`) groups these plus Blockly's built-in Logic/Loops/Math/Text/Variables categories, several with shadow-number defaults.

### 5.2 Generating Arduino C++ (`arduinoGenerator.js`)

A custom `Blockly.Generator('Arduino')` (`:10`). `init` sets up `includes_` (seeded `<Arduino.h>`), `definitions_`, and the variable-name DB (`:30-42`). `finish` assembles the final source: `#include`s + globals (every used workspace variable declared as `int name = 0;`, plus servo/sensor object declarations) + the setup/loop code, joined with blank lines (`:45-63`). `arduino_setup_loop` emits `void setup(){...}\n\nvoid loop(){...}\n` (`:75-79`). Each `forBlock` handler emits the matching C++ (e.g. `arduino_analogwrite` → `analogWrite(pin, val);`, `subo_run_motor` → `runMotor("F", speed);` and adds the `<MotorExpansion.h>` include). Sensor/servo blocks lazily register their library object once via `ensure*` helpers so the generated C++ also runs verbatim in the text editor (`:113-164`).

### 5.3 Same diagnostics + parser as the text editor

Live regen: a debounced (200 ms) change listener calls `arduinoGenerator.workspaceToCode(ws)` and mirrors the C++ into a preview + persists the workspace JSON (`BlocksPanel.jsx:78-95`). "To Code" copies the generated C++ into the shared store and switches to the Code panel (`:117`).

`handleRun()` (`:119-138`) is the crucial parity point: it picks the board (`subo` if a SUBO is in scene), runs `analyzeArduino(code, {board})` on the **generated** C++, renders the **same** `<CompilerOutput>` panel, and `if (!report.ok) return` — **blocking errors withhold execution exactly as in the text editor**. On pass it calls the identical `simulationManager.configure(...)` + `simulationManager.start(code)` runtime. So visual blocks flow through the same compile gate, the same `parseAndTranspile`, and the same execution/timing engine as hand-written code.


---

# Part 3 — Simulation, Physics, Robots & Combat

_Simulation, physics, robots (wheeled + legged), Robo-Sumo battle & Physics-Arena combat._

> Code-accurate feature reference. All constants, symbols and behaviours below are quoted from the actual source with `file:line` citations. Scale convention: **1 scene unit (su) = 5 cm** (`SCENE_TO_M = 0.05`, `src/managers/physics/EnvironmentConfig.js:4`).

---

## 1. Simulation Panel & In-Viewport Drive HUD

### 1.1 SimulationPanel (right-rail "Run → Simulation" section)
`src/components/SimulationPanel.jsx` — presentation-only wrapper; every control calls an existing store action (no new behaviour).

- **Start/Stop Simulation** button (`SimulationPanel.jsx:44-54`) toggles `uiStore.setSimActive`. On first start it fires `trackEvent('sim_started')` (`:46`). Label flips "Start Simulation" ⇄ "Stop Simulation"; running state shows a pulsing yellow button (`#eab308`), idle shows the orange accent gradient.
- **Environment picker** — 2×2 grid of 4 buttons (`ENVIRONMENTS` array `:16-21`): Earth 🌍, Moon 🌙, Mars 🔴, Zero-G 🛰️. Calls `physicsStore.setEnvironment(id)` (`:71`).
- **Gravity readout**: `Gravity: {gravity.toFixed(2)} m/s²` (`:85`).
- **Game Mode**: "Open Robo-Sumo Battle" button switches `activePanel` to `'battle'` (`:93`).
- Note (`:11-13`): the *detailed* drive/robot controls appear as the in-viewport **DrivePanel HUD** while a sim runs — this panel is only the entry point.

### 1.2 DrivePanel — in-viewport HUD
`src/components/DrivePanel.jsx`. A bottom-docked overlay (`absolute bottom-0 … z-20`, `:152`). Two top-level constants:

| Const | Value | File:line |
|---|---|---|
| `LEGGED_SPEED` | `8` su/s | `DrivePanel.jsx:11` |
| `LEGGED_TURN` | `1.8` rad/s | `DrivePanel.jsx:12` |

- **Physics status bar** (`:174-207`): Environment `<select>` (options from `ENVIRONMENTS` map), `g = {|gravity|} m/s²`, `ρ = {airDensity} kg/m³`, live `mass = {driveManager._totalMass} kg` (polled every 500 ms, `:51-56`), and `Wind {speed} m/s` when > 0.
- **Peripherals row** (`:210-256`): live sensor inputs (IR/ultrasonic/LDR/DHT11/color/gas via `SensorControl`), OLED screen readout, buzzer Hz indicator, and SUBO A/B buttons (`SUBO_BTN_L`=GPIO1, `SUBO_BTN_R`=GPIO47; digitalRead reads LOW while held).
- **Wheeled controls** (`:332-373`): ▶ Run Code / ⏹ Stop Code button calls `simulationManager.start(code)` via `handleRun` (`:99-121`); disabled when no motors and no connections. Shows serial log (last 120 chars) + an `analogWrite` quick-reference.
- **Legged controls** (`:260-328`): a 3×3 **D-pad** (▲◄●►▼, `:263-289`) plus arrow-key handlers. Both write `physicsStore.setLeggedControl(speed, turn)` via `applyLeggedControl` (`:60-70`): `speed = ±LEGGED_SPEED`, `turn = ±LEGGED_TURN`. Shows leg count + gait label (`tripod`/`trot`/`alternating`) from `driveManager._leggedSystem`. Optional "Run Code" for custom gait algorithms.
- Title bar shows `🕷 LEGGED SIMULATION` or `⚙ SIMULATION MODE`, plus a green "Code running" pulse and an **✕ Exit Simulation** button (`handleExit`, `:132-135`).

---

## 2. Physics Engine

### 2.1 EnvironmentConfig — presets (EXACT values)
`src/managers/physics/EnvironmentConfig.js`. `SCENE_TO_M = 0.05` (`:4`).

| Env | gravity (m/s², −Y) | airDensity (kg/m³) | groundFriction | rollingFriction | label |
|---|---|---|---|---|---|
| `earth` | **−9.80665** | 1.225 | 0.7 | 0.015 | `Earth (9.81 m/s²)` |
| `moon` | **−1.62** | 0 | 0.7 | 0.005 | `Moon (1.62 m/s²)` |
| `mars` | **−3.72** | 0.020 | 0.7 | 0.010 | `Mars (3.72 m/s²)` |
| `zero_g` | **0** | 0 | 0 | 0 | `Zero-G` |
| `underwater` | −9.80665 | 1000 (water-density drag) | 0.3 | 0.05 | `Underwater` |

(`earth`/`moon`/`mars`/`zero_g` are the 4 exposed in the UI; `underwater` exists in config but isn't in `SimulationPanel`'s picker.) `getEnvironmentParams(env)` falls back to `earth` (`:44-46`). `physicsStore` (`src/stores/physicsStore.js`) initialises from `ENVIRONMENTS.earth` and `setEnvironment` copies gravity/airDensity/groundFriction/rollingFriction into state (`:18-27`). Wind default `{ x:0, z:-1, speed:0, turbulence:0 }` (`:14`).

### 2.2 PhysicsManager (Rapier WASM)
`src/managers/physics/PhysicsManager.js`. Singleton `physicsManager`.

- Lazy-loads `@dimforge/rapier3d-compat`, `await R.init()` (`:5-11`).
- World gravity is stored in **scene units**: `y = earth.gravity / SCENE_TO_M` → −9.80665/0.05 ≈ **−196.13 su/s²** (`:29-32`). Kinematic bodies ignore gravity.
- **Ground plane**: fixed cuboid `200 × 1.0 × 200` su centred at `y = −1.0` so its top face is flush at y=0; friction = 0.7 (earth), restitution 0 (`:40-46`).
- `setGravity(y_m_s2)` guards NaN, converts by `/SCENE_TO_M` (`:56-64`).
- Body factories:
  - `createDynamicBody` — box collider, linearDamping 0.15, angularDamping 2.0, `canSleep=false`, friction 0.7, restitution 0.1 (`:71-94`).
  - `createCompoundBody` — one dynamic body, multiple box colliders (welded assembly); linDamp 0.12, angDamp 0.5, friction 0.8, restitution 0.04 (`:102-124`).
  - `createRobotBody` — **kinematicVelocityBased** (drive path); friction = earth ground (`:126-143`).
  - `createCombatBody` — **dynamic**, linDamp 0.6, angDamp 4.0, `enabledRotations(false, true, false)` (yaw-only, stays upright), friction 0.9, restitution 0.25, `COLLISION_EVENTS` active; sets real class mass via `col.setMass(mass)` (`:152-175`).
  - `createStaticObstacle` — fixed box, friction 0.7, restitution 0.2 (`:234-252`).
- `applyImpulse`, `applyTorqueImpulse` (`:178-187`); `raycast(origin, dir, maxToi=1000, excludeId)` returns `{id, toi, point}` (`:193-205`); `drainContactEvents(cb)` for combat ram detection (`:212-225`); `getLinvel` (`:228-231`).
- `step(dt)` clamps `timestep` to `[0.001, 0.05]` (`:265-271`).
- **COOP/COEP requirement**: Rapier needs SharedArrayBuffer → production must set COOP/COEP headers (`netlify.toml`/`vercel.json`); noted in CLAUDE.md.

### 2.3 PhysicsIntegrator (kinematic fallback / motor model post-processor)
`src/managers/physics/PhysicsIntegrator.js`. Used for wheeled + legged velocity shaping.

| Const | Value | Line |
|---|---|---|
| `Cd` (drag coeff, blocky) | 0.85 | `:3` |
| `MAX_V` (linear cap) | 40 su/s | `:4` |
| `MAX_OM` (angular cap) | π·8 rad/s | `:5` |

`step(targetV, targetOmega, dt, yaw, env)` applies in order (`:51-112`):
1. **Inertia** — first-order lag: `tau_v = mass × 0.12` s/kg, `tau_w = I × 0.10`; `alph = 1 − e^(−dt/tau)` (`:66-71`). (0.5 kg → τ≈0.06 s snappy; 5 kg → τ≈0.60 s sluggish.)
2. **Air drag** — quadratic `F = 0.5·ρ·Cd·A·v|v|`, only if airDensity>0 (`:74-79`); angular drag `omega *= e^(−0.25·dt)` (`:81-83`).
3. **Rolling friction** — constant decel `rollAcc = rollingFriction·g / SCENE_TO_M` (`:86-91`).
4. **Wind** — headwind component along forward axis with turbulence factor `1 + turbulence·(rand−0.5)·0.4` (`:94-105`).
5. **Clamp** to ±MAX_V / ±MAX_OM (`:108-109`).

### 2.4 MassCalculator (density × volume)
`src/managers/physics/MassCalculator.js`.

- **Densities (kg/m³)** `DENSITY` (`:4`): `plastic 1200`, `metal 7800`, `rubber 1200`, `default 1000`.
- **Fixed electronics masses (kg)** `ELEC_MASS` (`:7-10`): arduino 0.025, subo 0.020, motor 0.120, motor_bo 0.100, motor_dc 0.080, servo 0.021, led 0.003.
- `volumeM3(type, scale)` (`:16-49`) — per-primitive volume formulas using base geometry sizes (box 2×2×2, sphere r=1, cylinder r=1 h=2, etc.) × scale × `SCENE_TO_M`.
- `getMass` returns fixed mass for electronics else `max(0.001, volume × density)` (`:54-58`).
- `totalMass`, `totalMomentOfInertia` (parallel-axis about world-Y through pivot, `:69-78`), `maxFrontalArea` (`:81-92`).

---

## 3. DriveManager

`src/managers/DriveManager.js`. Singleton `driveManager`. Top consts: `MOTOR_TYPES = {motor, motor_bo, motor_dc}` (`:19`), `DRIVE_BODY_ID = 'robot_drive'` (`:20`), `MAX_V = 200` (max vertical fall speed clamp, `:21`).

### 3.1 enter(objects) flow (`:192-684`)
1. Split scene objects into robot parts (`topLevel`, go into `rootGroup`) vs **standalone obstacles** (only `sceneStore.standaloneIds` become fixed Rapier colliders); planes are skipped (`:200-210`).
2. **Path selection is blueprint-driven** (`:222-228`): `blueprintForObjects(ids) ?? autoBlueprintForObjects(topLevel)`, then `forcedPath = execPathFor(blueprint)` → `'wheeled' | 'legged' | 'freefall'`. Geometry only supplies mechanical parameters, never the type decision.
3. **Motor/axle detection** (`:239-344`): motors = parts whose type ∈ MOTOR_TYPES.
   - **≥2 motors and not legged/freefall** → wheeled. Left/right split along the *shorter* axis (track is narrower than wheelbase) so "forward" runs along the long axis (`:261-267`). Pivot = midpoint of side centroids; `wheelbase = max(0.5, |axle vector|)`; `_yawOffset = atan2(−dz, dx)` (`:283-294`).
   - **1 motor** → assigned as both left & right (drives straight) (`:300-314`).
   - **0 motors** → pivot = centroid of lowest-Y layer (support/fulcrum) (`:315-343`).
4. **Legged detection** (`:346-356`): when `forcedPath === 'legged'` OR (`forcedPath == null` and `<2 motors`), build a `LeggedSystem` from servo+arm `attachments`; on success sets `_isLegged`, `physicsStore.setIsLeggedRobot(true)`.
5. **Physics props** (`:358-372`): `robotMass = max(0.1, totalMass)`, `robotI`, `robotA`; builds a `PhysicsIntegrator`. Logs `[Physics] mass=… I=… A=…`.
6. Applies environment gravity to the Rapier world (`:373-375`).
7. **Freefall path** (`:388-482`): only when `forcedPath === 'freefall'` and Rapier ready. One Rapier body per *assembly* (welded group → compound body, loose object → simple body); standalone objects → static colliders. **Pre-warm**: 15 Rapier steps at 1 ms with zero gravity to resolve overlaps, then restore gravity (`:462-478`).
8. Otherwise **rootGroup path** (`:484-683`): creates `THREE.Group` at the axle pivot, re-parents meshes preserving world transforms, computes volume-weighted COM (`_comLocalZ/X/Y`), pitch/roll tipping extents, `_maxPitch = min(π·0.47, atan2(bodyH, pitchExtent·0.5))`, `_maxRoll = π·0.47`; creates a kinematic `createRobotBody`.

### 3.2 step() (per-frame, `:778-1101`)
- Clamps dt to 0.05; calls `aiRuntime.tick(dt, driveGroups)` so AI writes to the same `motorSpeeds` channel (`:786-788`).
- **Freefall**: applies gravity, steps Rapier, syncs each body → mesh with a hard floor clamp at `halfY` (`:793-840`).
- **Legged**: delegates to `_stepLegged(dt)` (`:842-846`).
- **Wheeled / non-wheeled** gravity: `gravAccel = gravity / SCENE_TO_M`, `_vy = max(_vy + gravAccel·dt, −MAX_V)` (`:857-860`).
- **Pitch/tipping physics** for non-wheeled bodies (`_leftIds.length===0`, `:882-984`): combines COM-tipping + settling-spring torques, blended by a `tipRatio`; damped `*= e^(−4·dt)`.
- **Ground clamp** (`:985-1011`): wheeled uses live `_lowestVisibleY()` each frame; non-wheeled uses real bbox min.
- **Wheeled drive** (`:1013-1100`): reads `simulationManager.motorSpeeds`, averages PWM per side, computes `{v, omega}` via `DifferentialDrive.compute()` (or a blueprint `ModuleHost`), runs through the `PhysicsIntegrator`, then sets Rapier `setLinvel({x:−v·sin(yaw), z:−v·cos(yaw)})` + `setAngvel({y:omega})` and steps the world (`:1077-1089`). Falls back to direct kinematic integration if Rapier isn't ready (`:1090-1100`).
- `_lowestVisibleY()` (`:1107-1144`): traverses visible solid meshes, **ignores** selection outlines / pins / labels, and **skips degenerate meshes** whose bbox spans > 0.5× the assembly height (e.g. subo.glb stray-vertex sub-meshes) so a phantom point doesn't float the robot.

### 3.3 _stepLegged(dt) — walk()/turn()/stopWalking() path (`:1174-1279`)
- Reads `physicsStore.leggedControl {speed, turn}` (D-pad/arrows).
- **Code-drive override** (`:1191-1197`): if code is running AND `simulationManager._leggedCmd` is set (the sketch called `walk()/turn()/stopWalking()`), it uses `simulationManager.leggedDrive.{speed,turn}` instead. `skipGait = (codeRunning && !codeDriving) || (speed===0 && turn===0)` — i.e. if code runs raw `Servo.write` only, the gait is skipped so code hand-animates the legs.
- Calls `_leggedSystem.step(dt, speed, turn, skipGait, physEnv, objectMgr)`, syncs knee servos to arm tips, applies gravity + live `_lowestVisibleY()` ground clamp, and drives the Rapier body yaw (`:1245-1278`).

**SimulationManager legged API** (`src/managers/SimulationManager.js:172-192`): `walk(speed)`, `turn(rate)`, `stopWalking()` inject a drive intent. `LEGGED_CODE_MAX_SPEED = 8` su/s (`:177`), `LEGGED_CODE_MAX_TURN = 1.8` rad/s (`:178`) — matched to DrivePanel. `walk(p)` sets `leggedDrive.speed = p·8`, `turn(p)` sets `leggedDrive.turn = p·1.8`, both flip `_leggedCmd = true`.

---

## 4. Robots — Wheeled & Legged Math

### 4.1 DifferentialDrive (wheeled)
`src/managers/robot/DifferentialDrive.js`. Motor model converting PWM (−255…+255) → v/omega.

| Param | Default | Line |
|---|---|---|
| `Kv` (rpm/V) | 20 | `:18` |
| `voltage` (V, 2S LiPo) | 7.4 | `:19` |
| `wheelRadius` (su) | 0.40 | `:20` |
| `wheelbase` (su) | 3.0 (overridden by DriveManager) | `:21` |

`pwmToVelocity(pwm)`: `rpm = Kv·voltage·|pwm|/255`; `radPerSec = rpm·2π/60`; return `radPerSec·wheelRadius·sign(pwm)` (`:30-34`). `compute(leftPWM, rightPWM)`: `v = (vL+vR)/2`, `omega = (vR−vL)/wheelbase` (`:37-43`). Calibrated so full throttle ≈ 6 su/s.

### 4.2 LeggedSystem (auto-detect + drive)
`src/managers/robot/LeggedSystem.js`. Consts: `DEFAULT_ARM_LEN = 2.5` (`:6`), `SWING_RANGE_DEG = 30` (hip ±30° from neutral 90°, `:7`), `LIFT_ADD_DEG = 40` (knee lift, `:8`).

- **Detection** (`build`, `:34-174`): collects servo+arm pairs from `attachments`; needs ≥2 pairs. Computes coefficient of variation (CV) of centroid distances. `useHipKnee = cv > 0.3 && pairs.length % 2 === 0` (`:73`) → splits inner (hips) / outer (knees) and pairs each hip with its nearest knee → **2-DOF legs**; else each pair is a **1-DOF leg**.
- **Gait choice by leg count** (`:137-158`): **n ≥ 6 → `tripod`** (phases alternate 0/0.5, stanceRatio 0.5); **n ≥ 4 → `trot`** (alternate 0/0.5, stance 0.6); **else → `alternating`** (phase `i/n`, stance 0.5). GaitEngine opts: `stepHeight 2.0, stepLength 2.5, cycleFreq 1.5`.
- `step()` (`:181-215`): for 2-DOF legs, hip servo = swing (`90 + norm·30°`), knee servo = lift (`90 − (lift/height)·40°`); for 1-DOF, one servo combines swing+lift. Body v/omega come from an internal `PhysicsIntegrator.step(speed, turn, …)`.
- Auto-detection of hexapod (6+ legs → tripod), quadruped (4-5 → trot), biped/other (<4 → alternating) is purely by count.

### 4.3 GaitEngine
`src/managers/robot/GaitEngine.js`. Phase tables: `TRIPOD_PHASES [0,.5,0,.5,0,.5]` (`:15`), `WAVE_PHASES [0,1/6…5/6]` (`:18`), `TROT_PHASES [0,.5,.5,0]` (`:22`), `WALK_PHASES [0,.25,.5,.75]` (`:25`). Defaults: `stepHeight 1.5, stepLength 2.0, cycleFreq 1.5, stanceRatio 0.6` (`:44-47`). `step(dt, forwardVelocity, turnRate)` (`:71-117`): advances a clock, splits each leg cycle into **stance** (foot on ground, slides back) and **swing** (`lift = stepHeight·sin(t·π)` arc). Factory helpers `createTripodGait` (stance 0.5), `createTrotGait` (0.6), `createWaveGait` (5/6) (`:129-146`).

### 4.4 IKSolver
`src/managers/robot/IKSolver.js`. Pure math (no Three.js). `solve2Joint(L1,L2,px,py,elbowUp)` — law-of-cosines 2-joint planar IK with workspace clamping (`:20-39`). `solve3Joint(Lcoxa,Lfemur,Ltibia,target)` — coxa yaw + 2-joint sagittal projection (`:51-63`). `isReachable2/3`, `interpolate` for smooth gait transitions (`:68-91`). (Note: LeggedSystem currently drives servos by angle directly; IKSolver is the foot-target math library.)

---

## 5. Robo-Sumo Battle (Mode A)

`src/managers/BattleManager.js` (singleton `battleManager`) + `src/stores/gameStore.js` + `src/components/BattlePanel.jsx`. **Arcade 2D disc physics** — NOT Rapier.

### 5.1 Tuning constants (`BattleManager.js:11-25`)

| Const | Value | Meaning |
|---|---|---|
| `RING_RADIUS` | 24 su | ring size (bigger = harder to push out) |
| `ACCEL` | 26 | forward acceleration |
| `MAX_SPEED` | 11 su/s | speed cap |
| `TURN_RATE` | 3.2 rad/s | steering |
| `FRICTION` | 2.6 | velocity damping/s |
| `RESTITUTION` | 0.45 | bounce on collision |
| `DMG_K` | 7.5 | damage per unit closing speed |
| `DMG_THRESH` | 1.2 | min closing speed to deal damage |
| `HIT_COOLDOWN` | 0.45 s | between damage events |
| `START_HP` | **100** | HP per round |
| `START_LIVES` | **3** | lives per match |
| `FRONT_TO_ANGLE` | `+z:0, +x:π/2, −z:π, −x:−π/2` | which face is the nose |

Robots spawn at `±RING_RADIUS × 0.55` facing centre (`:237-238`). Per-robot `mass = clamp(0.6…12, volume·0.12)`, `radius = max(0.6, max(sx,sz)/2)` (`:89-91`).

### 5.2 Simulation
- `_drive(r, input, dt)` (`:713-723`): heading += `turn·TURN_RATE·dt`; velocity += forward·ACCEL along heading; `*= max(0, 1−FRICTION·dt)`; clamp to MAX_SPEED.
- `_collide(now)` (`:725-755`): impulse-based disc collision with inverse-mass split; on `closing > DMG_THRESH` past cooldown → `dmg = round(DMG_K·closing)`; the mover heading *into* the contact deals full damage, the other takes 30% (`:749-750`); HP floored at 0 → KO ends round.
- `_checkRingOut(now)` (`:774-782`): `|pos| > RING_RADIUS` → that side loses the round (if both out, the farther one loses).
- `_endRound(winner, how)` (`:784-792`): decrements loser's life; 0 lives → `matchover` with winner; else `roundover` (2200 ms delay → next round, `:791`).

### 5.3 gameStore
`src/stores/gameStore.js`. State: `battleActive`, `mode` ('local'|'online'), `status` (setup|countdown|fighting|roundover|matchover|loading), `round`, `lives {p1:3,p2:3}`, `hp {p1:100,p2:100}` (`:42-46`).
- **Remappable controls** (`DEFAULT_CONTROLS`, `:6-9`): `p1 {up:w,down:s,left:a,right:d,front:+z,fire:Space}`, `p2 {arrows, front:+z, fire:Enter}`. Persisted to `localStorage['subo.controls']` (`CTRL_KEY`, `:10`). `setControl` / `resetControls` (`:49-54`).
- `_readKeys(c)` maps to `{forward, turn}` (`:702-708`).

### 5.4 Local vs Online
- **Local 2-player** (`startLocal`, `:231-242`): both robots simulated locally; P1 WASD, P2 arrows; `_stepLocal` (`:592-604`).
- **Online (WebRTC/PeerJS)** via `NetworkManager`: `connectHost`/`connectJoin` (`:245-256`), room-code invite. **Split authority** — host = p1, guest = p2; each client simulates its own robot and streams `{x,z,heading,vx,vz,hp}` state (`_sendState`, `:636-644`). Opponent shown first as a **box-cluster proxy** (`parts`, `:74-78`), then upgraded to exact streamed per-mesh geometry (`getRobotGeo`/`_sendMyGeo`, backpressure-paced at `bufferedAmount < 65536`, `:442-473`); orientation fixed via `geometa` (`:403-421`). 12 s load-timeout fallback (`:370`). `changeFront` remaps the nose live mid-match (`:426-436`).

### 5.5 BattlePanel UI (right rail "Run → Battle")
`src/components/BattlePanel.jsx`. Header `⚔ Robo Sumo — Battle`. Mode switch Same-PC / 🌐 Online (`:87-95`). Local: two `PlayerPick` dropdowns (candidates from `robotOptions()`), **⚔ Start Battle** (`startLocal`), **🤖 Physics Arena — You vs AI (beta)** button → `combatManager.startArena([p1Id, p2Id])` (`:105-110`). Online: Host/Join with room code, connection states. HUD (`HPBar`) shows name, ❤×lives, and an HP bar; round messages and a match-over Done button (`:54-74`). Rebindable controls editor + live "Front side" arrows (`ControlsLegend`/`LiveFront`, `:197-258`).

---

## 6. Combat Arena — "Physics Arena" (You vs AI)

`src/managers/CombatManager.js` (`combatManager`) + `src/combat/*` + `src/managers/arena/*`. Rapier-based; one dynamic body per robot. Launched from **Battle → 🤖 Physics Arena**. Ticked from `App.onAnimationTick` when `combatStore.arenaActive`.

### 6.1 Movement tuning (`CombatManager.js:38-54`)

| Const | Value | Meaning |
|---|---|---|
| `MAX_SPEED` | 16 su/s | top speed (fallback; per-robot stat overrides) |
| `ACCEL_GAIN` | 0.62 | fraction of velocity error corrected/frame |
| `TURN_RATE` | 5.0 rad/s | target yaw rate (fallback) |
| `TURN_GAIN` | 0.9 | steering responsiveness |
| `REVERSE_SCALE` | 1.0 | reverse = forward speed (balanced testing) |
| `ARENA_HALF` | 26 su | square arena half-width (walls at ±26) |
| `SPAWN_X` | 12 su | robots spawn at ±12 |
| `IMPACT_MIN` | 6 su/s | min closing speed for ram damage |
| `IMPACT_K` | 1.1 | damage per su/s above the floor |
| `HIT_CD` | 0.4 s | between ram-damage events per pair |

- `_drive(body, r, input)` (`:349-379`): impulse toward desired forward velocity `(des − v)·mass·accel`; torque impulse toward target yaw rate `(targetW − w)·mass·TURN_GAIN`. Move/turn are throttled by `stabilitySystem.authority`, `heatSystem.moveMult`, `statusEffectSystem.moveMult`.
- `_resolveImpact(idA, idB, now)` (`:382-411`): from contact events, `closing = |vA − vB|` on XZ; if ≥ IMPACT_MIN → `dmg = round(IMPACT_K·(closing − IMPACT_MIN))`. Faster mover = aggressor; defender takes full (armor + 0.6·stability + 0.5·heat), aggressor takes chip (0.3× armor/stability, 0.35× heat).
- Robot = ONE `createCombatBody` (yaw-locked upright), body id === assembly rootId. `_captureRobot` builds movers + reads weapon parts (`:208-273`).
- `_updateLean` — visual-only chassis pitch/roll/bob (accel lean, bank into turns), never touches physics (`:431-452`).
- Win check: last robot with `state !== 'destroyed'` wins → `status:'over'` (`:413-425`).

### 6.2 CombatStats — class from real mass
`src/combat/CombatStats.js`. `classForMass(kg)` (`:19-23`): **< 2 kg = light**, **< 8 kg = medium**, **≥ 8 kg = heavy**. `computeRobotStats(rootId)` (`:26-49`): `mass = max(0.3, totalMass)`; then:

| Stat | Formula | Range |
|---|---|---|
| `armorMax` | round(clamp(40 + mass·12)) | 40–400 |
| `coreMax` | round(clamp(60 + mass·8)) | 60–300 |
| `heatMax` | 100 | — |
| `stabilityMax` | 100 | — |
| `maxSpeed` | clamp(20 − mass·0.7) | 9–20 su/s |
| `accelGain` | clamp(0.66 − mass·0.01) | 0.4–0.66 |
| `turnRate` | clamp(5.4 − mass·0.09) | 3.2–5.4 rad/s |
| `recoilResist` | clamp(mass/20) | 0.05–0.9 |
| `explosionResist` | clamp(mass/25) | 0.05–0.85 |

### 6.3 DamageManager — the single funnel
`src/combat/DamageManager.js`. `DEFAULT_CRIT_MUL = 1.5` (`:23`). `apply(evt)` (`:42-85`):
1. Drop if target destroyed / friendly-fire gate blocks.
2. **Crit**: if `evt.crit && actor.armor <= 0`, `coreDmg = round(core · (critMul || 1.5))`.
3. **Armor absorbs first**: `armor = max(0, armor − armorDmg)`; leftover `overflow` spills to core.
4. `core = max(0, core − (coreDmg + overflow))`.
5. Stability & heat accumulate (clamped to max).
6. `core <= 0` → `state = 'destroyed'`.
`onApplied(id, result, evt)` mirrors to `combatStore.patchActor` + fans combat feedback (VFX, damage numbers, hit marker).

### 6.4 Weapons (`src/combat/weaponRegistry.js`)
Data-driven; strategies `ray | rocket | flame`. Damage `{armor, core, stability, heat}` per shot/pellet/rocket/tick.

| Weapon | key/strategy | damage (a/c/st/heat) | range | fireRateHz | mag / reloadMs | pellets/spread | heat/shot | recoil / knockback | crit | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **Auto Cannon** | autocannon / ray | 5/3/1/0 | 70 | 8 | 45 / 1600 | 1 / 1.6° | 2.4 | 2 / 1.5 | ✓ ×1.8 | sustained DPS |
| **Shotgun** | shotgun / ray | 6/2/3/0 per pellet | 24 | 1.2 | 6 / 1800 | 9 / 16° | 6 | 9 / 10 | ✓ ×1.4 | slow 0.25 / 500 ms |
| **Rocket Pod** | rocket / rocket | 20/14/20/6 (blast centre) | 90 | 2.5 | 3 / 3200 | burst 3 / 3° | 8 | 4 / 24 | ✗ | projSpeed 55, splashRadius 11, selfDamage core 8 |
| **Melee Strike** | melee / ray | 10/6/8/0 | 7 | 1.6 | 999 / 0 | 1 / 4° | 3 | 0 / 14 | ✓ ×1.5 | built-in RMB secondary; slow 0.35 / 400 ms |
| **Flamethrower** | flame / flame | 1/1/1/0 per tick/target | 15 | 14 | 140 / 2600 | 4 cone / 26° | 1.3 | 0 / 0 | ✗ | burning dps 9 / 2200 ms; self-slow 0.4 / 160 ms |

(`autocannon` `:40-49`, `shotgun` `:52-62`, `rocket` `:65-75`, `melee` `:80-89`, `flame` `:92-102`.) Weapons are scene parts of type `weapon_<key>`; the arena reads them off the assembly. `WeaponManager` (`src/managers/WeaponManager.js`): **primary = longest-range weapon (LMB); secondary = a second/shortest-range weapon or built-in Melee (RMB)** (`CombatManager.js:230-232`, `WeaponManager.js:53-59`). Firing withheld while overheated.

### 6.5 ProjectileManager & ExplosionSystem
- `src/combat/ProjectileManager.js`: rockets advanced by **swept raycast** each frame; `speed = def.projectileSpeed || 55`; `life = (range||80)/speed + 0.15` (`:20-28`). Detonates on hit, ground (`y ≤ 0.25`), or airburst at end of life (`:31-55`); pooled cone meshes.
- `src/combat/ExplosionSystem.js`: `detonate(pos, def, ownerId)` (`:32-72`): every robot within `splashRadius` (default 8) takes damage × linear `falloff = max(0, 1 − d/radius)`; outward + up-biased impulse `knockback·falloff·(1 − explosionResist)` (`:54-61`); owner self-damage; pooled flash (`life 0.4 s`) + camera shake `min(1.2, +0.6)`.

### 6.6 Combat sub-systems
- **StabilitySystem** (`src/combat/StabilitySystem.js`): `STAGGER_MS 1300`, `DRAIN_BASE 16`/s, `STAGGER_MOVE 0.35`, `STAGGER_TURN 0.40` (`:14-17`). Meter tops out → stumble (reduced move/turn) for 1300 ms; drains faster for sturdier builds (`0.6 + recoilResist`).
- **HeatSystem** (`src/combat/HeatSystem.js`): `COOL_RATE 14`/s, `RESUME_FRAC 0.5`, `OVERHEAT_MOVE 0.6` (`:13-15`). Heat ≥ max → overheat (0.6× move) until cooled below 50% (hysteresis).
- **StatusEffectSystem** (`src/combat/StatusEffectSystem.js`): timed effects `burning` (dps burn), `slow`/`disabled` (movement `×(1−magnitude)`), `repairing` (reserved). `add/tick/moveMult` (`:16-48`).
- **combatStore** (`src/stores/combatStore.js`): actor `{armor,core,heat,stability,staggered,overheated,state,team,effects}` via `makeActor` (`:19-31`); `playerId/enemyId/hitMarkerAt/cameraMode` HUD context; `patchActor`/`sync`/`reset`.

### 6.7 Third-person PvP layer (`src/managers/arena/`)
- **Camera modes** (`ArenaCameraModes.js`): `MODE_KEYS` (`:57-62`) — **F1 = shoulder, F2 = tactical, F3 = orbit, F4 = topdown**; Default (`'Combat'`) is the base view reached by pressing the active mode's key again. Each mode is `{distance, height, pitchDeg, fov, sideOffset, followYaw, orbit, lookAhead, armSmooth}` and blends ~300 ms:

  | Mode | key | distance | height | pitch° | fov | side | followYaw | orbit |
  |---|---|---|---|---|---|---|---|---|
  | default (Combat) | — | 13 | 6 | 17 | 70 | 0 | ✓ | ✗ |
  | shoulder | F1 | 8.5 | 4.2 | 11 | 74 | 2.2 | ✓ | ✗ |
  | tactical | F2 | 24 | 17 | 42 | 60 | 0 | ✓ | ✗ |
  | orbit | F3 | 15 | 8 | 18 | 68 | 0 | ✗ | ✓ (mouse) |
  | topdown | F4 | 2 | 34 | 86 | 52 | 0 | ✗ | ✗ |

  `ArenaCameraManager` snapshots + restores the shared editor camera, owns `CameraShake` and F-key handling; `ArenaCameraRig` = spring-arm chase (follow → arm → collision raycast → SmoothDamp), all critically damped (`smoothing.js`), frame-rate independent.
- **ArenaAIController** (`ArenaAIController.js`): easy/beatable 1v1 AI emitting the SAME `{fwd, turn, primary, secondary}` shape. Difficulty (`:38`, `:43`): `reactionMin 400 ms`, `reactionMax 600 ms`, **accuracy 0.7 (~70%)**, `aimTol 0.22 rad`. Behaviour: refreshes decisions every 400–600 ms, carries a persistent aim error `(rand−0.5)·2·((1−accuracy)·0.9)` (`:80`), 35% strafe chance, brief pause after firing (`:126-127`), backs off (`fwd −0.7`) when overheated (`:97-101`), unsticks with a wiggle when it stops moving (`:88-94`). Preferred stand-off = `min(primaryRange·0.7, 40)` (`:72`). No prediction/cover/flanking.
- **Player controls**: **WASD move** (mouse never rotates the robot), **LMB = primary**, **RMB = secondary**, **F1–F4 camera**. `_bindKeys`/`_readPlayerInput` (`CombatManager.js:477-518`) — movement keys come from `gameStore.controls.p1`; `turn = right − left`, `fwd = up − down`; RMB context-menu suppressed. `_captureRobot`/`equip` route weapons.
- **Feedback**: `CombatEffectsManager` fans `DamageManager.onApplied` + `WeaponManager.onFire` + `ExplosionSystem.onDetonate` → `HitEffects` (sparks/smoke/debris/armor-shards/destroyed fire), `DamageNumbers` (DOM overlay), `ArenaAudio` (WebAudio placeholder, unlocks on first click), `CameraShake`. `CombatHUD` (`src/components/combat/CombatHUD.jsx`) shows player L / enemy R cards, crosshair + hit marker (from `hitMarkerAt`), ability bar, camera-mode legend, overheat vignette, Exit.

### 6.8 UI location
Physics Arena is launched from **BattlePanel** (right rail "Run → Battle") via the "🤖 Physics Arena — You vs AI (beta)" button (`BattlePanel.jsx:105-110`), only enabled when two distinct robots are picked in local mode. Robot[0] = player (WASD/LMB/RMB/F1–F4), robot[1] = AI enemy (`CombatManager.js:119-126`).


---

# Part 4 — UI Page-Map, CAD Tools & Shortcuts

_The UI shell / page map, CAD tools & keyboard shortcuts — where every option lives._

> Code-accurate reference. Every claim cites `file:line`. Paths relative to `c:\projects\toolsapp`.
> The shell is assembled in `src/App.jsx` `AppEditor()` (return block `App.jsx:536-590`).

---

## 1. Overall UI Shell — the Page Map

The app is a **vertical flex column** filling the screen: `<div className="flex flex-col h-screen …">` (`App.jsx:537`). Top-to-bottom it is exactly three bands: **Header → middle row → StatusBar**. The middle row (`App.jsx:539` `<div className="flex flex-1 min-h-0">`) is a horizontal flex: **Viewport (left, grows) → resize handle → right workspace (fixed width)**.

```
┌──────────────────────────────────────────────────────────────────────┐
│ HEADER  (Header.jsx) — 🧊 3D Editor · project name · ☀/🌙 · ? Help · 💾 Save · ☰ File │  h-12, z-40
├──────────────────────────────────────────────────────────────────────┤
│ ┌ Tools ┐                                              ┌───────────┐┌────┐ │
│ │toolbox│            VIEWPORT (Viewport.jsx)           │  active   ││icon│ │
│ │top-3  │            Three.js canvas (grows)           │  section  ││rail│ │
│ │left-3 │                              ┌ View Cube ┐   │  panel    ││ w-14│
│ │ z-20  │                              │ top-3     │   │ (body)    ││    │ │
│ └───────┘                              │ right-3   │   └───────────┘└────┘ │
│                                        │ z-viewCube│    ◄─ResizeHandle      │
│                                        └───────────┘   width 224–560px      │
├──────────────────────────────────────────────────────────────────────┤
│ STATUSBAR (StatusBar.jsx) — Objects: N · Selected · Pos · Mode · Shortcuts  │  h-7
└──────────────────────────────────────────────────────────────────────┘
```

| Region | Component | Location / mount | Source |
|---|---|---|---|
| Top bar | `Header` | full-width band, top | `App.jsx:538`; `Header.jsx:194` `h-12 … z-40` |
| Floating Tools toolbox | `ViewportToolbox` | **inside** viewport, `absolute top-3 left-3 z-20`, width `176px` | mounted `Viewport.jsx:852`; positioned `ViewportToolbox.jsx:102` |
| View Cube | `ViewGizmo` | **inside** viewport, `absolute top-3 right-3`; **hidden while sim active** (`{!simActive && <ViewGizmo/>}`) | mount `Viewport.jsx:855`; pos `ViewGizmo.jsx:72` |
| Center canvas | `Viewport` | primary surface, grows | `App.jsx:541` |
| Resize handle | `ResizeHandle` | thin bar between viewport and right workspace, `cursor-col-resize` | `App.jsx:543`, def `App.jsx:93-101` |
| Right workspace | section body + icon rail | `flex shrink-0`, width = `rightWidth` state (default **300**, clamped **224–560px**) | `App.jsx:546`; width state `App.jsx:130`; clamp `App.jsx:135` |
| Bottom bar | `StatusBar` | full-width band, bottom, `h-7` | `App.jsx:573`; `StatusBar.jsx:11` |

The **right workspace** is itself two columns (`App.jsx:546-571`): the **active section panel body** on the left (`flex-1`, scrolls, `App.jsx:548-553`) and the **grouped icon rail** on the right (`nav … w-14`, `App.jsx:556`). A `PanelHint` renders above the panel body (`App.jsx:550`).

**Overlay layer** (bottom of `AppEditor`, `App.jsx:578-588`): `OverlayBridge`, `DiscordGate`, `EmailCapture`, `CombatHUD`, `WelcomeOverlay`, `ProductTour`, `GuidedCoach`, `KeyboardShortcutsModal`, `BeginnerGuideModal` — all fixed/absolute overlays, not part of the flex flow.

---

## 2. The Header (top bar) — every control, left→right

Source: `Header.jsx:194-280`. Band style: orange-tinted gradient, `borderBottom` accent (`Header.jsx:194-195`).

| Order | Control | Exact label / glyph | Action | Source |
|---|---|---|---|---|
| 1 | Logo | `🧊` + **"3D Editor"** (gradient text, hidden on small screens) | none (branding) | `Header.jsx:197-203` |
| 2 | Project-name field | editable `<input>`, bound to `projectName` | renames project (`setProjectName`) | `Header.jsx:206-212` |
| — | spacer | `flex-1` pushes rest to the right | — | `Header.jsx:214` |
| 3 | Theme toggle | **"☀️ Light"** (when dark) / **"🌙 Dark"** (when light) | `toggleTheme()` | `Header.jsx:217-225`, `handleToggleTheme` `Header.jsx:54` |
| 4 | Help menu | `HelpMenu` component (renders a **"?"**/Help button + dropdown) | tutorials/tour/shortcuts/beginner guide | `Header.jsx:228` |
| 5 | Save | **"💾 Save"** → **"Saving…"** → **"✓ Saved"** (green flash) | `storageManager.saveProject`, tracks `project_saved`, fires `constructa:saved` | `Header.jsx:231-244`, `handleSave` `Header.jsx:87-98` |
| 6 | File menu | **"☰ File"** button → dropdown | opens menu (below) | `Header.jsx:247-271` |

**☰ File dropdown** (`Header.jsx:255-270`, items via `MenuItem` `Header.jsx:366-379`):

| Item | Label | Action | Handler |
|---|---|---|---|
| 📄 | **New Project** | confirm → `clearScene` + reset | `handleNewProject` `Header.jsx:101-109` |
| 📂 | **Open Saved…** | opens saved-projects dialog | `handleOpenDialog` `Header.jsx:112-117` |
| — divider — | | | |
| ⬇ | **Export JSON** | `saveJSONToFile(snapshot)` | `handleExportJSON` `Header.jsx:134-137` |
| ⬆ | **Import JSON** | file picker → `applyProjectData` | `handleImportClick` `Header.jsx:175-178` |
| — divider — | | | |
| 🔗 | **Copy Share Link** | packs project into URL hash, copies to clipboard | `handleShareLink` `Header.jsx:140-155` |
| 🖨 | **Export STL (3D print)** | printability check dialog → `exportSTL` | `handleExportSTL` `Header.jsx:158-173` |

**Note:** there is **no Google-Drive button in the Header** in this code — sharing is via **Copy Share Link** (URL hash) only. STL export lives in the File menu (item 🖨). The **Open Saved Project** modal (`Header.jsx:291-361`) lists IndexedDB projects with per-row 🗑 delete. A share-link toast appears at `top-14 right-4` (`Header.jsx:283-288`).

---

## 3. Floating "Tools" Toolbox (top-left of viewport)

Source: `ViewportToolbox.jsx`. Header reads **"Tools"** with a move icon (`ViewportToolbox.jsx:105-108`). Width `176px`, `z-20`, glass style (`ViewportToolbox.jsx:102-103`). Every tile is an equal-size `Tile` (`ViewportToolbox.jsx:37-56`) showing icon + label + a **corner keycap** + optional badge. Four groups separated by dividers:

### Group A — Transform (3-col grid, `ViewportToolbox.jsx:112-125`)
Data from `TRANSFORM_MODES` (`ViewportToolbox.jsx:24-28`). Corner shows the shortcut key.

| Tile | Label | Corner key | Sets | Tutorial anchor |
|---|---|---|---|---|
| move | **Move** | **W** | `transformMode='translate'` | `mode-translate` |
| rotate | **Rotate** | **E** | `transformMode='rotate'` | `mode-rotate` |
| scale | **Scale** | **R** | `transformMode='scale'` | `mode-scale` |

### Group B — Solid-edit tools (3-col, `ViewportToolbox.jsx:130-138`)
| Tile | Label | Toggles | Notes | Source |
|---|---|---|---|---|
| surface | **Surface** | `surfaceToolActive` | Surface Attach — click faces to snap/bond, or drag a custom patch; badge = patch count | `ViewportToolbox.jsx:131-133`, handler `85-88` |
| extrude | **Extrude** | `extrudeToolActive` | click a face to pull it out into a new solid | `ViewportToolbox.jsx:134-135`, handler `89-93` |
| slice | **Slice** | `sliceToolActive` | draw a line across a selected shape to cut it | `ViewportToolbox.jsx:136-137`, handler `94-97` |

These three are **mutually exclusive** — turning one on turns the others off (handlers `85-97`).

### Group C — Snap + View + Guides (3-col, `ViewportToolbox.jsx:143-154`)
| Tile | Label (dynamic) | Action | Source |
|---|---|---|---|
| magnet | **"{n}u"** / "Move" | cycles move-snap step: **Off / 0.5 / 1 / 2 units** (`TRANSLATE_STEPS` `line 30`) | `ViewportToolbox.jsx:144-146` |
| rotate | **"{n}°"** / "Rot" | cycles rotation snap: **Off / 15° / 45° / 90°** (`ROTATE_STEPS` `line 31`) | `ViewportToolbox.jsx:147-149` |
| guides | **Guides** | toggles `smartGuides` (smart alignment guide lines) | `ViewportToolbox.jsx:150-151` |
| grid | **Grid** | `toggleGrid` (also **G** key) | `ViewportToolbox.jsx:152` |
| axes | **Axes** | `toggleAxes` (also **A** key) | `ViewportToolbox.jsx:153` |

### Group D — 3D-print build plate (2-col, `ViewportToolbox.jsx:159-164`)
| Tile | Label | Action | Source |
|---|---|---|---|
| printer | **Bed** | toggles `printBedVisible` | `ViewportToolbox.jsx:160-161` |
| grid | **"{n}mm"** (e.g. `220mm`) | cycles build-plate size: **180 / 220 / 256 / 300 mm** (`BED_SIZES` `line 32`) | `ViewportToolbox.jsx:162-163` |

> The toolbox **never creates objects** — creation lives in the right-panel Library/Electronics/Mechanical sections (comment `ViewportToolbox.jsx:15-21`).

### View Cube (`ViewGizmo`, top-right of viewport)
Interactive iso-cube (`ViewGizmo.jsx`): clickable **Top / Front / Right** faces on the cube (`FACES` `ViewGizmo.jsx:27-31`); a chevron expands a grid of all six views **Top/Front/Right/Back/Left/Bottom** (`VIEWS` `ViewGizmo.jsx:17-24`) plus a **Home (Iso)** button (`ViewGizmo.jsx:145-154`). A live label shows the current orientation (`ViewGizmo.jsx:117-119`). It fades out (`useAnyOverlay`) whenever any overlay/dropdown/modal is open (`ViewGizmo.jsx:43,74`).

---

## 4. The Right Icon-Rail — WHERE EVERY OPTION LIVES (most important)

Rail definition: `RAIL` array `App.jsx:456-482`. Rendered bottom-right as a `w-14` vertical nav (`App.jsx:556-570`); each button is a `railButton` (`App.jsx:507-527`) with a `data-tour="tab-<id>"` anchor and a 2-line icon+label. Clicking sets `activePanel` (`App.jsx:513`). Panel body chosen by `renderPanelBody` (`App.jsx:487-505`). Only **one section shows at a time**; the active one highlights orange (`App.jsx:517`).

**Groups & sections in rail order** (dividers between groups, `App.jsx:566`):

| Group | Rail id | Rail label | Panel component | What it does |
|---|---|---|---|---|
| **Design** | `properties` | **Props** | `PropertiesPanel` (default) | selected-object editor (see §6) — `App.jsx:502-503` |
| | `objects` | **Objects** | `ObjectList` | scene hierarchy / multi-select / visibility — `App.jsx:490` |
| | `library` | **Library** | `AssetLibrary` | shapes, Text, built-in models, GLB/GLTF/STL/SVG import, saved assets (see §5) — `App.jsx:496` |
| **Create** | `electronics` | **Elec** | `ElectronicsLibrary` | MCUs (Arduino/SUBO), motors, servos, LEDs, sensors, weapons — `App.jsx:497` |
| | `mechanical` | **Mech** | `MechanicalLibrary` | Gear / Bolt / Screw / Star (see §5) — `App.jsx:498` |
| **Build** | `wiring` | **Wiring** | `WiringPanel` | pin-to-pin wiring; opening it reveals **all** boards' pins (`App.jsx:267`) — `App.jsx:491` |
| | `joints` | **Joints** | `JointPanel` | mechanical joint editor — `App.jsx:492` |
| | `robot` | **Robot** | `RobotPanel` | robot blueprint / modules — `App.jsx:493` |
| **Program** | `blocks` | **Blocks** | `BlocksPanel` (in `PanelErrorBoundary`) | Blockly → Arduino C++ — `App.jsx:494` |
| | `code` | **Code** | `CodeEditor` | Arduino C++ editor + Run + compiler diagnostics — `App.jsx:501` |
| **Run** | `sim` | **Sim** | `SimulationPanel` (boundary) | start/stop simulation, environment — `App.jsx:499`; title tooltip "Simulation" `App.jsx:514` |
| | `battle` | **Battle** | `BattlePanel` (boundary) | Robo-Sumo + Physics-Arena entry — `App.jsx:495` |
| **Setup** | `settings` | **Settings** | `SettingsPanel` | theme, grid/axes, snap, print bed — `App.jsx:500` |

### The injected **Boolean** section (conditional)
When a **second object is shift-selected** and both are boolean-capable, a **Boolean** rail button is injected **at the top of the rail** (above all groups) with a purple active state (`App.jsx:558-563`), and the app auto-switches to it (`App.jsx:163-170`). It disappears when the pair breaks (`App.jsx:485` guard). Candidate check = `isBooleanCandidate` (geometry OR electronics types) `BooleanPanel.jsx:53-56`. Panel = `BooleanPanel` (`App.jsx:489`). See §5.

---

## 5. CAD / Creation Tools in Detail

### 5a. Primitives via number keys 1–0
Handler: `SHAPE_KEYS` map `App.jsx:56`, dispatched at `App.jsx:377` (`addObject(SHAPE_KEYS[e.key])`). **Exact mapping:**

| Key | Shape (type) |
|---|---|
| **1** | Cylinder (`cylinder`) |
| **2** | Cone (`cone`) |
| **3** | Cube (`box`) |
| **4** | Sphere (`sphere`) |
| **5** | Tetrahedron (`tetrahedron`) |
| **6** | Square Pyramid (`pyramid`) |
| **7** | Pentagonal Pyramid (`pentpyramid`) |
| **8** | Octahedron (`octahedron`) |
| **9** | Dodecahedron (`dodecahedron`) |
| **0** | Rectangular Prism (`rectprism`) |

(Matches the `KeyboardShortcutsModal` "Create shapes" list `KeyboardShortcutsModal.jsx:7-11`.)

### 5b. Library section (`AssetLibrary.jsx`) — the click-to-add palette
- **Import drop zone** at top: click or drag a file; accepts **GLB · GLTF · STL · SVG** (`AssetLibrary.jsx:176-205`, accept string `line 200`). GLB/GLTF → `loadGLTFFromFile`; STL → `loadSTLFromFile`; SVG → `svgTextToGeometry` extruded to a solid CSG object (`AssetLibrary.jsx:104-120`).
- **Basic** group (`SHAPE_GROUPS[0]` `AssetLibrary.jsx:11-25`): Cube, Sphere, Cylinder, Cone, Rect Box, Plane, Torus, Capsule, **Text**.
- **Polyhedra** group (`AssetLibrary.jsx:26-38`): Tetrahedron, Octahedron, Dodeca, Tri Prism, Hex Prism, Sq Pyramid, Pent Pyr.
- **Models** (built-in GLB, `MODELS` `AssetLibrary.jsx:48-50`): currently **Wheels** (`free_wheels`) only.
- **My Assets** (`AssetLibrary.jsx:248-285`): user-saved assets from `assetStore`; empty-state points to "Properties → Save as Asset".

### 5c. Mechanical section (`MechanicalLibrary.jsx`)
`PARTS` list (`MechanicalLibrary.jsx:11-16`): **Spur Gear** (`gear`), **Bolt** (`bolt`), **Screw** (`screw`), **Star Knot** (`star`). Each button calls `addObject(type)` (`MechanicalLibrary.jsx:21`).

### 5d. Boolean operations (`BooleanPanel.jsx`)
`OPERATIONS` `BooleanPanel.jsx:9-38`:
| id | Button label | Effect |
|---|---|---|
| `union` | **Union** (⊕) | merge A + B into one shape |
| `subtract` | **A − B** (⊖) | cut B out of A |
| `subtractB` | **B − A** (⊖) | cut A out of B |
| `intersect` | **Intersect** (⊗) | keep only the overlap |

Runs `runBoolean(selectedId, secondaryId, opId)` (`BooleanPanel.jsx:84`), replaces the two sources with one CSG object, and **re-points surface bonds** that touched either source onto the result (`BooleanPanel.jsx:99-128`). Cancel button deselects the 2nd object (`BooleanPanel.jsx:194-199`).

### 5e. Extrude / Fillet / Slice / Bend / Dimensions / Bonding / Gears
- **Extrude:** toolbox tile (§3-B) drives face extrude; also an **"Extrude Face"** `<details>` inside Properties (`PropertiesPanel.jsx:1182-1192` → `ExtrudePanel`). `ExtrudePanel` also mounts in the viewport (`Viewport.jsx:859`).
- **Fillet / Chamfer:** two places — (1) box/rectprism-only **Edge Style** block in Properties with Fillet/Chamfer + All/Pick-Edges + per-edge 2×2 grid + radius slider (`PropertiesPanel.jsx:936-1089`); (2) a general **"Fillet / Bevel"** `<details>` → `FilletPanel` (`PropertiesPanel.jsx:1195-1205`).
- **Slice:** toolbox tile (§3-B); the editable cut-line overlay `SlicePolylineOverlay` renders in the viewport when `sliceToolActive` (`Viewport.jsx:713`).
- **Bend / Deform:** Properties **Bend** block — axis x/y/z buttons + angle slider ±180° + numeric + reset (`PropertiesPanel.jsx:1092-1171`, non-electronics, non-csg).
- **Dimension Editor (typed W/H/D):** Properties **Dimensions** block → `DimensionEditorPanel` (`PropertiesPanel.jsx:1174-1179`). Editor supports **Center** vs **One-Sided** (locked-face) scaling (`DimensionEditorPanel.jsx:35`, axes W=x/H=y/D=z `DimensionEditorPanel.jsx:15-19`).
- **Surface bonding:** toolbox **Surface** tool picks patches; the **Surface Patches** panel (`SurfacePatchPanel`, `PropertiesPanel.jsx:80-143`) exposes editable W/H per patch + **"⊕ Surface Attach — Align & Bond"** (`PropertiesPanel.jsx:123-130`, handler `handleRigidAttach` `194-216`). Existing bonds show as **Surface Bond** badges with world-position inputs, rotate-on-surface ±90°/180°, and Detach (`PropertiesPanel.jsx:474-548`). Live prompt `SurfaceAttachPrompt` mounts in viewport (`Viewport.jsx:858`).
- **Gear pairing:** Gear-only block in Properties — Teeth/Module/Width/Bore sliders + **"Mesh with…"** dropdown listing other gears, ratio display, and per-pair remove (`PropertiesPanel.jsx:831-933`, via `gearStore` mesh pairs).

---

## 6. PropertiesPanel contents (Design → Props section)

Source: `PropertiesPanel.jsx:385-1283`. Empty state when nothing selected (`PropertiesPanel.jsx:364-371`). Sections in render order:

1. **Surface-patch panel** (if patches selected) — `PropertiesPanel.jsx:388-399`.
2. **Name** text field — `PropertiesPanel.jsx:402-410`.
3. **Attachment badge** (when riding a motor rotor): Snap-to-shaft **Tip/Mid/Base** presets, fine X/Y/Z position (X=along shaft, Y/Z=radial), Detach — `PropertiesPanel.jsx:413-472`.
4. **Rigid bond badges** (Surface Bond) — world-position inputs + rotate-on-surface + Detach Bond — `PropertiesPanel.jsx:474-548`.
5. **Transform** (hidden while attached): **Position** (Vec3), **Rotation (°)** (Vec3) + **Snap to Axes** button, **Scale** (Vec3, non-electronics only) — `PropertiesPanel.jsx:551-594`.
6. **Size** (electronics only): a uniform slider **0.3–3** + numeric box, applies scale.x=y=z evenly (electronics don't get the XYZ scale gizmo, would skew pins) — `PropertiesPanel.jsx:598-619`.
7. **Attachment Point** picker (◎ Pick Attachment Point) — click the exact spot on a prop that touches a motor shaft — `PropertiesPanel.jsx:624-659` (`data-tour="pick-attach"`).
8. **Direct attach** to a shift-selected motor/servo (⚙ Attach to …) — `PropertiesPanel.jsx:662-679`.
9. **Shaft Attachment** — Tip/Mid/Base snap + Center/→Tip/Base← alignment + per-target Attach buttons — `PropertiesPanel.jsx:682-755`.
10. **Rotating Part** picker (motors only) — pick which mesh spins — `PropertiesPanel.jsx:758-787`.
11. **Color** — color picker + hex input — `PropertiesPanel.jsx:790-808`.
12. **Material** — 3 buttons **standard / metallic / transparent** (`MATERIAL_TYPES` `PropertiesPanel.jsx:46`) — `PropertiesPanel.jsx:811-828`.
13. **Gear** params (gears only) — `PropertiesPanel.jsx:831-933`.
14. **Edge Style** (box/rectprism) — Fillet/Chamfer — `PropertiesPanel.jsx:936-1089`.
15. **Bend** — `PropertiesPanel.jsx:1092-1171`.
16. **Dimensions** → `DimensionEditorPanel` — `PropertiesPanel.jsx:1174-1179`.
17. **Extrude Face** `<details>` → `ExtrudePanel` — `PropertiesPanel.jsx:1182-1192`.
18. **Fillet / Bevel** `<details>` → `FilletPanel` — `PropertiesPanel.jsx:1195-1205`.
19. **Inspect** `<details>` — Mass, Size W×H×D, Center, and distance-to-2nd-selection — `PropertiesPanel.jsx:1207-1208,1393-1434`.
20. **Text** editor (text objects) — string/size/thickness — `PropertiesPanel.jsx:1211,1288-1324`.
21. **Align (2 objects)** `<details>` — Min/Center/Max per axis — `PropertiesPanel.jsx:1214,1327-1381`.
22. **Pattern / Mirror** `<details>` — Linear/Circular/Mirror arrays — `PropertiesPanel.jsx:1217,1440-1552`.
23. **Type** (Hole/Solid toggle) + **Group** (Ctrl+G) / **Ungroup** (Ctrl+Shift+G) — `PropertiesPanel.jsx:1220-1251`.
24. **Visible** toggle — `PropertiesPanel.jsx:1254-1266`.
25. **Duplicate / Delete** buttons — `PropertiesPanel.jsx:1268-1281`.
26. **📦 Save as Asset** (non-electronics) — `PropertiesPanel.jsx:1282`, `SaveAssetButton` `1554-1576`.

---

## 7. Complete Keyboard Shortcut Table

Editor key handler: `App.jsx:332-447` (`handleKeyDown`). **All shortcuts are blocked while a battle/arena is active** (`App.jsx:337`, arena/battle own WASD+arrows). Shape/tool keys are ignored while typing in an input/textarea (`App.jsx:333-334,376`).

### Editor shortcuts

| Shortcut | Action | Source |
|---|---|---|
| **W** | Transform → Move (translate) | `App.jsx:438` |
| **E** | Transform → Rotate | `App.jsx:439` |
| **R** | Transform → Scale (**blocked for electronics types** — `ELEC_TYPES` `App.jsx:57`) | `App.jsx:440-445` |
| **1–0** | Add primitive (see §5a mapping) | `App.jsx:377` |
| **Ctrl/⌘ + Z** | Undo | `App.jsx:339` |
| **Ctrl/⌘ + Y** | Redo | `App.jsx:340` |
| **Ctrl/⌘ + C** | Copy selected (non-electronics only) | `App.jsx:343-349` |
| **Ctrl/⌘ + V** | Paste (offset +2,+2 in X/Z) | `App.jsx:351-365` |
| **Ctrl/⌘ + D** | Smart Duplicate (first = offset copy; then repeats the demonstrated delta = array) | `App.jsx:392-394`, `smartDuplicate` `295-330` |
| **Ctrl/⌘ + G** | Group selected pair (CSG combine; holes subtract) | `App.jsx:368-373` |
| **Ctrl/⌘ + Shift + G** | Ungroup | `App.jsx:368-373` (`e.shiftKey`) |
| **Delete / Backspace** | Delete selected object — or delete selected surface patches if the Surface tool is active | `App.jsx:380-391` |
| **G** | Toggle Grid | `App.jsx:418` |
| **A** | Toggle Axes | `App.jsx:419` |
| **F** | Frame/fit selection (or reset camera if nothing selected) | `App.jsx:420-421` |
| **Shift + S** | Snap rotation to nearest axes (0/90/180/270) | `App.jsx:426-437` |
| **Esc** | Cancel wire drag if dragging, else clear selection | `App.jsx:422-425` |
| **Shift + Click** | Select a 2nd object (Boolean/joints/align) — *mouse* | `KeyboardShortcutsModal.jsx:32` |
| **↑ ↓ ← →** | Nudge selected object by snap step (or 1u); **Shift = vertical (Y)**. Skipped while simulation active (arrows then drive legged robots) | `App.jsx:395-417` |

### Camera (mouse, edit mode)
`Scroll` = Zoom · `Middle-drag` = Orbit · `Right-drag` = Pan (`KeyboardShortcutsModal.jsx:36-40`; also CLAUDE.md controls table).

### Simulation / Battle / Arena keys
These bypass the editor handler (editor shortcuts are disabled while active, `App.jsx:337`):
- **Legged sim:** **↑↓←→** drive the legged robot (arrow-nudge is skipped when `simActive`, `App.jsx:398`).
- **Robo-Sumo Battle:** **P1 = WASD**, **P2 = arrow keys** (remappable via `gameStore`; per CLAUDE.md controls table).
- **Physics Arena (You-vs-AI):** **WASD** move · **LMB** primary weapon · **RMB** secondary/melee · **F1–F4** camera views (Default/Shoulder/Tactical/Orbit/Top-Down) · legacy fire keys `Space`/`Enter` (per CLAUDE.md; player = robot[0]).

### StatusBar cheat-sheet (bottom bar, always visible)
Reads: *"1-0 add shape · W/E/R move·rotate·scale · G grid · A axes · Del delete · Ctrl+Z/Y undo/redo · F fit · Shift+S snap axes"* (`StatusBar.jsx:34`). It also shows **Objects: N**, selected name, position, and current transform **Mode** (`StatusBar.jsx:12-32`).

### KeyboardShortcutsModal groups (Help → Keyboard Shortcuts)
Full modal (`KeyboardShortcutsModal.jsx:4-41`) is grouped: **Create shapes** (1–0), **Transform** (W/E/R, Shift+S), **Edit** (Ctrl+Z/Y/C/V/D, Delete), **View & selection** (G, A, F, Shift+Click, Esc), **Camera (mouse)** (Scroll/Middle/Right-drag).


---

# Part 5 — Dependencies, Build & Infrastructure

_Dependencies, tech stack, build/deploy, storage, state & infrastructure._

> Code-accurate as of branch `sureshv1`. All facts cite `file:line`. Repo root: `c:\projects\toolsapp`.
> Package identity: `name: "3d-design-editor"`, `version: "1.0.0"`, `type: "module"`, `private: true`, Electron entry `main: electron/main.cjs` (`package.json:2-6`). Note the *build*/brand name is **Imaginarium** (`package.json:47` `productName`), brand = **Constructa**.

---

## 1. Dependencies — exact versions & purpose

All versions are the semver ranges declared in `package.json` (`:18-44`). Runtime deps `:18-30`, dev deps `:31-44`.

### Runtime dependencies (`dependencies`)

| Package | Version (range) | Purpose |
|---|---|---|
| `@dimforge/rapier3d-compat` | `^0.19.3` | WASM rigid-body physics engine (Rapier). Excluded from Vite dep pre-bundle — `vite.config.js:9-11`. |
| `blockly` | `^11.2.2` | Google Blockly — visual block programming → Arduino C++. |
| `peerjs` | `^1.5.5` | WebRTC P2P transport (PeerJS) for online Robo-Sumo. Imported in `NetworkManager.js:1` (`import Peer from 'peerjs'`). |
| `react` | `^18.3.1` | Component UI runtime. |
| `react-dom` | `^18.3.1` | React DOM renderer. |
| `three` | `^0.168.0` | Three.js 3D rendering core (imported as `import * as THREE` across all managers). |
| `three-bvh-csg` | `^0.0.18` | Boolean CSG (union/subtract/intersect) on meshes. **Source of the `--legacy-peer-deps` requirement** (peer-dep conflict). |
| `three-mesh-bvh` | `^0.9.10` | BVH acceleration structure (raycast/CSG speedups); peer dep of three-bvh-csg. |
| `three-stdlib` | `^2.29.9` | OrbitControls / TransformControls / GLTF·STL·SVG loaders / exporters (the non-core three add-ons). |
| `uuid` | `^10.0.0` | ID generation (`v4`) for scene objects, joints, bonds, assets. |
| `zustand` | `^5.0.0` | State store library (all ~14 stores). |

### Dev dependencies (`devDependencies`)

| Package | Version (range) | Purpose |
|---|---|---|
| `@types/react` | `^18.3.3` | React type defs (editor tooling). |
| `@types/react-dom` | `^18.3.0` | React DOM type defs. |
| `@vitejs/plugin-react` | `^4.3.1` | Vite React plugin (JSX/Fast-Refresh) — wired in `vite.config.js:2,5`. |
| `autoprefixer` | `^10.4.20` | PostCSS autoprefixer — `postcss.config.js:4`. |
| `cross-env` | `^7.0.3` | Cross-platform env-var setting in npm scripts (used for `VITE_BASE`, `ELECTRON_START_URL`). |
| `electron` | `^31.7.7` | Desktop shell runtime. |
| `electron-builder` | `^24.13.3` | Windows/desktop packaging (`build:win` → `--win`). |
| `gh-pages` | `^6.3.0` | Publish `dist/` to the `gh-pages` branch (`deploy` script). |
| `playwright` | `^1.60.0` | Headless UI/theme verification (dev only). |
| `postcss` | `^8.4.47` | CSS pipeline for Tailwind — `postcss.config.js`. |
| `tailwindcss` | `^3.4.14` | Utility CSS framework (token-remap config). |
| `vite` | `^5.4.8` | Dev server + production bundler. |

> **No external icon library, no CSS framework CDN, no backend SDK** — icons are inline SVG; there is no login/auth package.
> **Install caveat:** `three-bvh-csg` has a peer-dep conflict; installs may need `npm install --legacy-peer-deps`. Encoded for Netlify as `NPM_FLAGS = "--legacy-peer-deps"` (`netlify.toml:13`).

---

## 2. npm scripts (`package.json:7-17`)

| Script | Command | What it does |
|---|---|---|
| `dev` | `vite` | Dev server. Base path `/Imaginarium/` → app is served at `http://localhost:5173/Imaginarium/`. |
| `build` | `vite build` | Production build to `dist/` (keeps the `/Imaginarium/` base unless `VITE_BASE` is set). |
| `preview` | `vite preview` | Serve the built `dist/` locally. |
| `predeploy` | `cross-env VITE_BASE=./ vite build` | Auto-runs before `deploy`; builds with a **relative** base for GitHub Pages. |
| `deploy` | `gh-pages -d dist` | Publishes `dist/` to the `gh-pages` branch. |
| `electron` | `electron .` | Launch the Electron desktop shell against built files. |
| `electron:dev` | `cross-env ELECTRON_START_URL=http://localhost:5173 electron .` | Electron pointed at the live Vite dev server. |
| `build:electron` | `cross-env VITE_BASE=./ vite build` | Build with relative base for Electron packaging. |
| `build:win` | `cross-env VITE_BASE=./ vite build && electron-builder --win` | Build + package a Windows app (NSIS installer + portable — `package.json:50`). |

- **Base path caveat:** the default base is `/Imaginarium/`; you MUST hit `localhost:5173/Imaginarium/`, not root.
- **Build-vs-dev caveat (from CLAUDE.md):** don't run `npm run build` while `npm run dev` is live — the build rewrites `dist/` and can crash the Windows dev watcher (`EBUSY … dist/…glb`).
- **electron-builder config** (`package.json:45-51`): `appId: com.imaginarium.editor`, `productName: Imaginarium`, output dir `release/`, packs `dist/**/*` + `electron/**/*`, Windows targets `["nsis","portable"]`.

---

## 3. Build configuration

### `vite.config.js`
- Plugin: `@vitejs/plugin-react` (`:5`).
- **Base path** (`:8`): `base: process.env.VITE_BASE ?? '/Imaginarium/'`. GitHub Pages serves under `/Imaginarium/`; Netlify/Vercel override with `VITE_BASE=/` at build time.
- **Rapier excluded from dep-optimizer** (`:9-11`): `optimizeDeps.exclude: ['@dimforge/rapier3d-compat']` (WASM must not be pre-bundled).
- **Two HTML entry points (multi-page)** (`:16-21`): `rollupOptions.input = { main: 'index.html', utm: 'utm-dashboard.html' }`. The second page is the standalone UTM analytics dashboard. Comment notes a `public/*.html` with inline `<style>` collides with Vite's inline-css proxy — hence declaring both as inputs.

### `tailwind.config.js`
- `content: ["./src/**/*.{js,jsx}"]`, `darkMode: 'class'` (`:3-4`).
- **Token-remap strategy (no markup edits to flip themes):**
  - `primary` = `rgb(var(--a-600))` = **#F97316 orange**; `secondary` = `--a-500` = #FB923C (`:10-11`).
  - `gray-50…950` → `rgb(var(--g-*) / <alpha-value>)` neutral channels (`:19-31`).
  - `indigo-50…950` → **remapped to the orange accent** `--a-*` (`:37-49`) — every existing `indigo-*` class renders orange in both themes.
  - `slate-600…900` → theme-aware **text** channels mapped onto `--g-*` so "strong text" inverts in dark mode (`:56-61`).
- Token values themselves live in `src/styles/globals.css` (space-separated RGB so Tailwind `<alpha-value>` opacity works).

### `postcss.config.js`
- Plugins: `tailwindcss` + `autoprefixer` (`:2-5`). Standard pipeline.

---

## 4. Deploy, hosting & security headers

Three deploy targets, each providing the base-path override and (where possible) real HTTP headers.

### Base path per host
- **GitHub Pages:** base `/Imaginarium/` (Vite default) or relative `./` via `predeploy`; custom domain via CNAME.
- **Netlify:** `netlify.toml` — `[build] command="npm run build"`, `publish="dist"`, `[build.environment] VITE_BASE="/"`, `NPM_FLAGS="--legacy-peer-deps"` (`:5-13`). SPA fallback redirect `/* → /index.html` status 200 (`:16-19`).
- **Vercel:** `vercel.json` — `buildCommand:"npm run build"`, `outputDirectory:"dist"`, `build.env.VITE_BASE="/"`, rewrite `/(.*) → /index.html` (`:1-5`).

### Custom domain
- `public/CNAME` → `constructa.atumx.in` (`CNAME:1`). This is the production app host.
- Landing page (separate) `https://constructa-page.atumx.in` — mobile visitors of the app host are redirected there pre-bundle (`index.html:36,42-44`).

### Security headers
Real HTTP headers are set by **three files** (identical header set): `netlify.toml:22-31`, `vercel.json:6-18`, and `public/_headers` (Netlify/Cloudflare-Pages style, `:1-8`). GitHub Pages cannot send headers, so `index.html` carries a **CSP meta tag** + a JS clickjacking break-out fallback.

| Header | Value | Source |
|---|---|---|
| `X-Frame-Options` | `DENY` | `_headers:2`, `netlify.toml:26`, `vercel.json:10` |
| `X-Content-Type-Options` | `nosniff` | `_headers:3` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `_headers:4` (also `<meta name=referrer>` `index.html:17`) |
| `Strict-Transport-Security` (HSTS) | `max-age=31536000; includeSubDomains; preload` | `_headers:5` |
| `Cross-Origin-Opener-Policy` (COOP) | `same-origin-allow-popups` | `_headers:6` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), payment=(), usb=()` | `_headers:7` |
| `Content-Security-Policy` | full policy (below) | `_headers:8` + `index.html:16` meta |

**CSP (identical in all four locations — `index.html:16`, `_headers:8`, `netlify.toml:31`, `vercel.json:16`):**
```
default-src 'self'; base-uri 'self'; object-src 'none';
script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://apis.google.com https://accounts.google.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
media-src 'self' blob: data:;
connect-src 'self' https: wss: ws: blob: data:;
worker-src 'self' blob:;
frame-src https://accounts.google.com https://content.googleapis.com;
form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```
- `'unsafe-eval'`/`'wasm-unsafe-eval'` are required because the **Arduino simulator uses `eval`** and **Rapier uses WASM** (`index.html:7-13`).
- `'unsafe-inline'` in `script-src`/`style-src` for the inline theme/redirect scripts + Tailwind.
- `blob:`/`data:` in `img-src`/`connect-src` because three.js fetches embedded GLB textures via `blob:` (`index.html:12-13`).
- `apis.google.com`/`accounts.google.com`/`content.googleapis.com` are pre-allowed in `script-src`/`frame-src` (for potential Google integration), though the current `sureshv1` File menu does not actually invoke gapi (see §7).

### COOP/COEP note for Rapier
CLAUDE.md and multiple config comments state production needs **COOP + COEP** headers to enable `SharedArrayBuffer` for Rapier WASM. **Observation:** the shipped configs set **COOP = `same-origin-allow-popups`** but do **NOT** set a `Cross-Origin-Embedder-Policy` (COEP) header in `_headers`/`netlify.toml`/`vercel.json`. So cross-origin isolation (and hence `SharedArrayBuffer`) is not fully enabled by these files as written — worth flagging as a documentation-vs-code gap. Rapier's `-compat` build is the WASM-inline variant, which mitigates this in practice.

### `index.html` runtime guards (`index.html:21-47`)
- **Frame-buster** (`:21-26`): if framed, redirects top or hides the doc (clickjacking guard; meta CSP can't set `frame-ancestors` on GH Pages).
- **Device split** (`:33-47`): on production host `constructa.atumx.in`, mobile UA → `location.replace('https://constructa-page.atumx.in' + search + hash)` (carries UTM). Bypass with `?app=1`. Runs before the bundle downloads.
- **Theme pre-paint** (`:55-68`): reads `localStorage['app-theme']` (default `dark`), stamps `data-theme` + inline background (`#F7F7F7` light / `#121212` dark) to avoid flash.

---

## 5. State management — Zustand stores (`src/stores/*` + `src/onboarding/onboardingStore.js`)

14 stores (13 in `stores/` + the UI-only onboarding store). Managers hold imperative logic; components subscribe and call managers. Each store below with its initial/held state.

| Store | File | What it holds (initial state) |
|---|---|---|
| **sceneStore** | `sceneStore.js` | `objects[]`, `selectedId`, `secondaryId`, `gridVisible:true`, `axesVisible:true`, `projectId` (uuid), `projectName:'Untitled Project'`, `standaloneIds[]`. Actions: add/remove/update/duplicate object, CSG add, group/ungroup (Tinkercad hole-boolean via `runBoolean`), `toggleHole`, clearScene, setObjects/ProjectName/Id (`:8-210`). Spawn-offset + colour logic per type (`:20-64`). |
| **uiStore** | `uiStore.js` | `activePanel:'properties'`, `transformMode:'translate'`, `statusMessage:'Ready'`, snap (`snapTranslate:0`, `snapRotateDeg:0`), print bed (`printBedVisible:false`, `printBedSizeMm:220`), smart guides (`smartGuides/snapObject/snapSurface:true`), tool flags (`surfaceToolActive`, `simActive`, `sliceToolActive`, `extrudeToolActive`, `extrudeState`) (`:3-52`). |
| **electronicsStore** | `electronicsStore.js` | `connections{}` (connId→{fromPinId,toPinId}), `code` (default Arduino sketch), `blocksJson`, `simulation{running,motorSpeeds{},servoAngles{}}`, `attachments{}` (objectId→motorId), `sensorValues{}`, `autoSense:true` (`:28-140`). Also exports pure helpers: `SUBO_IO_TO_GPIO`, `SUBO_ADC_IOS`, `pinNameToNumber`, `buildPinToComponentMap`, `buildSensorInputMap`, `isSensorPowered` (`:146-267`). |
| **physicsStore** | `physicsStore.js` | Derived from `EnvironmentConfig.ENVIRONMENTS.earth`: `environment:'earth'`, `gravity`, `airDensity`, `groundFriction`, `rollingFriction`; `wind{x:0,z:-1,speed:0,turbulence:0}`, `groundType:'concrete'`; legged control (`isLeggedRobot:false`, `leggedControl{speed,turn}`, `leggedGaitType:'auto'`) (`:6-42`). |
| **combatStore** | `combatStore.js` | Physics-Arena runtime: `arenaActive:false`, `status:'idle'`, `message`, `winnerTeam`, `actors{}` (rootId→actor), `playerId`, `enemyId`, `hitMarkerAt:0`, `cameraMode:'default'`. `makeActor()` shape: armor/core/heat/stability + staggered/overheated/state/effects (`:19-65`). |
| **gameStore** | `gameStore.js` | Robo-Sumo: `battleActive`, `mode:'local'`, `p1Id/p2Id`, online (`role`, `connState:'idle'`, `roomCode`, `netError`, `myRobotId`, `oppName`, `oppReady`), match (`status:'setup'`, `round:1`, `lives{p1:3,p2:3}`, `hp{p1:100,p2:100}`, `winner`), **remappable `controls`** persisted to `localStorage['subo.controls']` (`:6-69`). |
| **rigidStore** | `rigidStore.js` | Surface bonds: `bonds{}` (bondId→{parentId,childId,relativeMatrix[16],contactLocalNormal,contactLocalCenter}); add/update/remove/setBonds/removeBondsForObject/getBonds (`:7-43`). |
| **surfaceStore** | `surfaceStore.js` | Surface patches: `patches{}` (id→patch), `selectedIds[]` (max 2). add/remove/update/toggleSelect/clear/setPatches/removePatchesForObject (`:3-40`). |
| **jointStore** | `jointStore.js` | Mechanical joints `joints{}`. `JOINT_TYPES` = fixed/hinge/revolute/slider/ball/servo (with axis/limits/motorized flags). Default joint: type `hinge`, axis {0,1,0}, limits, motorSettings, currentAngle/Position, ballRot. Actions: add/update/remove, driveJoint (clamped), driveBall (`:4-115`). |
| **assetStore** | `assetStore.js` | User-saved assets in `localStorage['3d_editor_saved_assets']`. `assets[]` loaded on init; saveAsset (deep-clones + `_savedId`), deleteAsset (`:16-31`). |
| **gearStore** | `gearStore.js` | Gear pairings `meshPairs[]` ({id,gearAId,gearBId}). addMeshPair/removeMeshPair/removePairsForGear (`:4-19`). |
| **robotStore** | `robotStore.js` | Robot blueprints `blueprints{}` (id→RobotBlueprint). add/update/remove; `setBlueprints` migrates via `migrateBlueprint`; `blueprintForObjects` (root then membership) (`:8-37`). |
| **historyStore** | `historyStore.js` | Read-only mirror of undo/redo command stacks: `undo[]`, `redo[]`, `open` (open txn label), `_set`. HistoryManager pushes; nothing reads back (`:6-11`). |
| **onboardingStore** | `onboarding/onboardingStore.js` | 100% UI/presentation state, never imports a manager. Welcome (localStorage `tinkerbot.welcomeSeen.v1`), tour, missions (legacy), guided coach, reference modals, dismissed hints (localStorage `tinkerbot.panelHints.v1`) (`:12-86`). |

> **Persistence split (Key Architecture):** onboarding + saved assets + game controls use **localStorage**; the actual project save/load uses **IndexedDB** (§7). They are independent.

---

## 6. Managers — imperative logic layer (`src/managers/*`)

Managers own all Three.js / physics / network mutation; components call them; stores stay declarative. The render loop is `SceneManager.onAnimationTick` (injected by App). Nearly all import `import * as THREE from 'three'`.

| Manager | File | One-line purpose |
|---|---|---|
| SceneManager | `SceneManager.js` | Scene/renderer/camera/lights/grid; render loop (`onAnimationTick`); named views; gizmo; snap; print bed. |
| ObjectManager | `ObjectManager.js` | Mesh registry; add/remove/update; animateServo/Motor/Led; setBend; reattachLocal; gear chains; bond propagation. |
| AlignmentManager | `AlignmentManager.js` | Magnetic smart-align + fading guide lines during a Move drag (placement-only). |
| DriveManager | `DriveManager.js` | Enter/exit simulation; routes wheeled (≥2 motors) vs legged. |
| SimulationManager | `SimulationManager.js` | Transpiles + runs Arduino/SUBO C++; exposes motorSpeeds/servoAngles/ledBrightness; injects SUBO + sensor libs. Imports electronicsStore pin-map helpers (`:1`). |
| WireManager | `WireManager.js` | 3D wire tubes; drag-to-connect; hidden-until-needed pin reveal. |
| JointManager | `JointManager.js` | Joint markers + constraint solving / child driving; `createFeatureJoint`. |
| ExtrudeTool | `ExtrudeTool.js` | Face extrusion on BufferGeometry. |
| FilletTool | `FilletTool.js` | Vertex chamfer/bevel. |
| PatchManager | `PatchManager.js` | Surface patches, face picking, extrude hover preview. |
| **StorageManager** | `StorageManager.js` | IndexedDB persistence + auto-save (see §7). |
| BattleManager | `BattleManager.js` | Robo-Sumo arcade 2D disc physics, HP, ring-out + WebRTC netcode. |
| NetworkManager | `NetworkManager.js` | WebRTC P2P transport via PeerJS (`import Peer from 'peerjs'`, `:1`). |
| CombatManager | `CombatManager.js` | Physics-Arena orchestrator (1 Rapier body/robot, player-vs-AI, damage, camera/effects/audio wiring). |
| WeaponManager | `WeaponManager.js` | Per-robot weapons (primary/secondary slots: ray/rocket/flame), reload/heat, GLB mounts, VFX. |
| **arena/** (10 files) | `arena/*` | Third-person PvP layer: ArenaCameraManager/Rig/Modes, CameraShake, smoothing, ArenaAIController, CombatEffectsManager, HitEffects, DamageNumbers, ArenaAudio. |
| **history/** (3 files) | `history/*` | Command-stack undo/redo: `HistoryManager` (1000-cap, transactions), `Command`/`CompositeCommand`/`SnapshotCommand`, single `editorDispatch` mutation facade. |
| **physics/** (4 files) | `physics/*` | `PhysicsManager` (Rapier world + combat bodies), `PhysicsIntegrator` (kinematic fallback), `MassCalculator` (volume×density), `EnvironmentConfig` (presets — see below). |
| **robot/** (4 files) | `robot/*` | `LeggedSystem` (auto hexapod/quad/biped), `GaitEngine` (tripod/trot/alternating), `IKSolver`, `DifferentialDrive`. |

**Physics environment presets** (`physics/EnvironmentConfig.js:6-42`) — scale constant `SCENE_TO_M = 0.05` (1 su = 5 cm, `:4`):

| env | gravity (m/s²) | airDensity | groundFriction | rollingFriction |
|---|---|---|---|---|
| earth | -9.80665 | 1.225 | 0.7 | 0.015 |
| moon | -1.62 | 0 | 0.7 | 0.005 |
| mars | -3.72 | 0.020 | 0.7 | 0.010 |
| zero_g | 0 | 0 | 0 | 0 |
| underwater | -9.80665 | 1000 (drag≈water) | 0.3 | 0.05 |

(Note: an `underwater` preset exists in code beyond the Earth/Moon/Mars/Zero-G set the docs usually cite.)

---

## 7. Storage & persistence

### IndexedDB (project save/load + autosave) — `StorageManager.js`
- DB: `'3d-editor'`, version `1`, object store `'projects'` with `keyPath: 'projectId'` (`:1-24`).
- Async API: `saveProject(data)` (stamps `modified` ISO timestamp, `:26-34`), `loadProject(id)` (`:36-43`), `deleteProject(id)` (`:45-53`), `getAllProjects()` (`:55-62`).
- **Auto-save** (`:64-74`): `enableAutoSave(getProjectData, intervalMs = 30000)` → `setInterval` calling `saveProject` every **30 s** by default; `disableAutoSave()` clears it. Wired in `App.jsx:275-279` (enabled on mount, disabled on unmount). Singleton export `storageManager` (`:77`).

### Share links (URL-hash, no backend) — `utils/share.js`
- Packs a full project snapshot into `window.location.hash`. Uses **gzip via `CompressionStream`** when available (2-char codec tag `g:`), else raw base64 (`r:`) (`:34-48`).
- base64url encode/decode helpers (`:5-17`); `buildShareUrl(snapshot)` → `${origin}${pathname}#share=<payload>` (`:51-55`); `readShareFromHash()` decodes `#share=…` on load (`:59-68`); `clearShareHash()` strips it from the address bar (`:71-75`).
- Consumed in `Header.jsx:5` (import), `:143-146` (`handleShareLink` builds the URL, fires `trackEvent('share_link_created', {parts})`, replaces address bar), `:79` (opens a shared link on mount).

### Export / import — `utils/export.js` + `utils/printExport.js`
- `export.js`: `downloadJSON(data, filename)` (`:1-9`), `saveJSONToFile(data, name)` — uses File System Access API `showSaveFilePicker` with download fallback (`:14-39`), `readJSONFile(file)` — FileReader → parsed JSON (`:41-51`).
- `printExport.js`: `printableObjects(objects)` (`:11`), `analyzePrintability(objects, bedMm=220)` (`:61`), `exportSTL(objects, filename='model.stl')` (`:96`). STL export gated behind a printability pre-check (`Header.jsx:158-172`).
- File menu (`Header.jsx:260-267`): New Project · Open Saved… · Export JSON · Import JSON · Copy Share Link · Export STL (3D print).

### Google Drive — DOCUMENTATION-vs-CODE GAP
- CLAUDE.md roadmap lists "Google Drive integration" as completed, and the CSP pre-allows `apis.google.com`/`accounts.google.com`/`content.googleapis.com`.
- **However, on the current `sureshv1` branch the File menu contains NO Drive item** (`Header.jsx:255-268` — only JSON/share/STL), and there is **no `gapi`/Drive-picker/OAuth loader wired into the runtime**. Grep hits for `drive`/`picker` in `src/` are unrelated (weapon "flame drive", feature "picker" raycasts, etc.). Treat Drive as **not present in this branch's UI** despite the roadmap claim.

---

## 8. Analytics — backend-free UTM tracking (`utils/utmTracking.js` + `utm-dashboard.html`)

Fully backend-free: one record per browser tab-session, written to localStorage immediately and beaconed once to a Google Apps Script at session end.

- **Collector endpoint** (`utmTracking.js:21`): a Google Apps Script Web-app URL —
  `https://script.google.com/macros/s/AKfycbxgWlc_0ZkVdtNGznRm1pCRmKZes18Yrm_XzgDknByKcRfiHxfNh6lfgM0EWIi2SKc0sw/exec` (same default hard-coded in `utm-dashboard.html:157`).
- **localStorage keys** (`:15-19`): `utm_visits_v1` (max 1000, `:19,85-93`), `utm_first_touch_v1`, `utm_visitor_v1` (returning-visitor flag), `utm_logged_session` (sessionStorage — one record per tab).
- **Session record schema** (`captureUTM`, `:106-155`): id, ts, source (utm_source or inferred from referrer host, `:50-63`), medium, campaign, term, content, ref, tagged, referrer, landing, country, device_type (`:35-42`), is_returning_visitor, popup_action (`ignore|join|dismiss`), session_duration, ua, language, timezone.
- **Country enrichment** (`:66-71`): async fetch to `https://ipwho.is/` (free, no-key, CORS).
- **Send mechanism** (`:95-103`): `navigator.sendBeacon` with `text/plain` Blob (a "simple" request → no CORS preflight); fallback `fetch(…, {mode:'no-cors', keepalive:true})`. Fired on `pagehide` / `visibilitychange→hidden`, plus a 15-min fallback timer (`:141-150`).
- **Event funnel** (`trackEvent`, `:170-191`): named events (`app_loaded`, `code_run`, `sim_started`, `arena_started`, `share_link_created`, `project_saved`, `discord_join`, `email_submitted`, …), correlated to the visit via session id (`sid`) with seconds-since-load (`t`). `app_loaded` fired in `App.jsx:600`.
- **Email capture** (`submitEmail`, `:194-199`) → logged as `email_submitted` event. **Discord popup** action recorded via `recordPopupAction` (`:158-163`).
- **Dashboard** (`utm-dashboard.html`, 2nd Vite HTML input): reads the local `utm_visits_v1` AND pulls all visitors' records from the Sheet via **JSONP** (`?callback=…` / `?events=1&callback=…`, `:180,225`) — no CORS. Its inline CSS is injected via JS (`:7-9`) to dodge the Vite multi-page inline-`<style>` proxy bug. Setup docs: `docs/UTM-SETUP.md`; collector script: `docs/utm-collector.gs`.

---

## 9. Runtime requirements & browser support

From CLAUDE.md + code behavior:
- **WebGL 2.0** — Three.js rendering (canvas must have dimensions > 0).
- **ES2020+** — modern JS (optional chaining, nullish coalescing used throughout).
- **IndexedDB** — project persistence (`StorageManager`).
- **SharedArrayBuffer** — Rapier WASM physics; needs cross-origin isolation (COOP/COEP) in production. The `-compat` (WASM-inline) Rapier build reduces this dependency; note COEP is not actually set in the shipped configs (§4).
- **WebRTC** — online Robo-Sumo only (PeerJS); may need TURN relays on restrictive networks.
- **Optional progressive-enhancement APIs:** `CompressionStream`/`DecompressionStream` (share-link gzip, falls back to base64), File System Access API `showSaveFilePicker` (falls back to download), `navigator.sendBeacon` (falls back to fetch), `navigator.userAgentData` (device detection).

| Browser | Support (CLAUDE.md) |
|---|---|
| Chrome | Full (recommended) |
| Firefox | Full |
| Safari | Full (macOS 10.11+) |
| Edge | Full |

**Platform:** desktop web (responsive) + Electron shell. Mobile users of the live app host are redirected to the landing page pre-bundle (`index.html:33-47`); mobile responsiveness of the editor itself is still a roadmap item.
