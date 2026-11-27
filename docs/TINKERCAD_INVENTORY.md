# Tinkercad → Constructa component inventory

Status as of 2026-11-27, branch `components_list`.

## Progress (updated after each phase)

The live, test-backed status is in `docs/parts-test-dashboard.html`
(`npm run test:dashboard`). The target list it checks is `src/parts/tinkercadCatalog.js`.

**Last run:** all 110 catalogue items are implemented and under test, with 598 aspect checks
passing, 0 failing and 0 not tested. The whole suite passes: 1176 tests in 49 files. N/A cells
are aspects that do not exist for an item (pins on a 3D shape, code generation for a
resistor). Entries marked `verify` in the catalogue are the least certain Tinkercad names.

| Phase | State |
|---|---|
| 0. Single registry | Done. `src/parts` registry (lazy catalogue chunk); the eight copied type lists read `src/utils/elecTypes.js` |
| Circuit solver | Done. MNA with Newton (with a cold restart when a warm start cycles) and companion models for C/L. Elements: R, V, I, C, L, diode/LED/Zener, BJT, MOSFET, switch, op-amp. PWM is switched at 490/980 Hz in time-based circuits, and sampled at 16 phases and averaged in DC circuits. |
| Boards | Uno (full header), ESP32, SUBO, **ATtiny85** (logic level follows its own VCC; pins 0–5; diagnostics rules) and **micro:bit** (Arduino-nRF5 option, `docs/MICROBIT_RUNTIME.md`; P0–P20, buttons A/B, 5×5 display) |
| Library | Done. Search, category filters, drag-and-drop into the viewport (onto the workplane when one is set) |
| Breadboards | Done. Mini, Small and full, with internal nets, auto-plug and grid snap |
| Basic / semis | Done (12): resistor, capacitors, inductor, potentiometer, diodes, BJTs, MOSFETs, relay, optocoupler |
| Inputs / sensors | Done (16): pushbutton, slide and DIP switches, keypad, tilt, photoresistor, photodiode, ambient light, TMP36, flex, force, PING))), IR receiver, IR remote |
| Lights / displays / outputs | Done (14 types): RGB LED, bulb, bar graph, 7 NeoPixel variants, 7-segment, LCD 16×2 parallel and I²C, vibration motor |
| ICs / logic / drivers | Done (13): 555, 74HC595, L293D, LM741, LM7805, LM317, CD4511, 74HC00/02/04/08/32/86 |
| Power / instruments | Done (10): 9V, coin cell, AA, 2xAA and 4xAA packs, solar cell, bench supply, multimeter, function generator, oscilloscope |
| Pre-existing parts | Uno, LED, piezo, DC motor, gearmotor, micro servo, PIR, ultrasonic, soil, gas: now under the same per-aspect contract (`tests/parts/legacy.test.js`) |
| 3D shapes | Done. The ten new shapes (`src/utils/shapes3d.js`) plus the pre-existing Box, Cylinder, Sphere, Roof, Cone, Torus, Pyramid, Text and both hole shapes, all tested as closed solids through real CSG |
| 3D tools | Done. Workplane, Ruler and Notes are wired into the toolbox, viewport, ruler panel and note overlay. Align, Mirror, Group/Ungroup, Duplicate and Hole/Solid are tested through their real code. |
| Transpiler | Arduino Print semantics (char as a character, float to 2 decimals, `HEX`/`BIN`/`OCT`/`DEC`), unary `&`/`*`, lowercase library classes, an awaited `waitForKey()` |

**Known limits:**
- **micro:bit language:** it is programmed with the Arduino API only. MicroPython is the planned next runtime (`docs/MICROBIT_RUNTIME.md`).
- **Unsupported C++:** `Class::method` and `byte(x)` style casts.
- **PWM precision:** in DC circuits PWM resolves to 1/16 duty steps.
- **Solver step:** the time-based step is at least ≈14 µs per frame, which limits signal sources to about 1–2 kHz.

Authoring guide for new parts: `docs/PARTS_AUTHORING.md`.

**Source caveat.** Tinkercad's own component pages render with JavaScript and could not be
fetched. The Tinkercad column comes from the Circuits and 3D Design panels as they are known,
not from a fetched list. Check each item against the in-app component search before
building it. Items marked `(?)` are the least certain.

Legend: ✅ in Constructa · 🟡 partly there (a different form or missing a feature) · ❌ missing

---

## 1. How a part is registered today (the cost of adding one)

Adding one electronics type means editing about 16 places. Eight of them are copies of
the same "is this an electronics type" list:

| Where | What it holds |
|---|---|
| `utils/wiring.js` | `ELEC_TYPES` set and `PIN_DEFS` (pin names) |
| `utils/electronicsFactory.js` | 3D pin positions (`PIN_DEFS`) and the mesh builder |
| `stores/sceneStore.js`, `stores/electronicsStore.js`, `managers/ObjectManager.js`, `utils/printExport.js`, `components/CodeEditor.jsx`, `components/PhysicsPanel.jsx` | copies of the type list |
| `robot/componentRegistry.js` | category, role, physics modules, current draw |
| `managers/physics/MassCalculator.js` | mass |
| `components/ElectronicsLibrary.jsx` | library card |
| `components/WiringPanel.jsx`, `components/WiringWorkbench.jsx` | icon, colour, 2D symbol |
| `arduino/sensorSim.js`, `managers/SimulationManager.js` | readings and outputs |
| `blockly/arduinoBlocks.js`, `blockly/arduinoGenerator.js` | blocks and the C++ they generate |

**Phase 0 (before adding parts):** derive every copied list from `componentRegistry.js`,
so one new part is one registry entry plus its model, pins and simulation hook.

## 2. Simulator capability (the main constraint)

`SimulationManager` works at **pin level**. A board pin drives a component directly (LED
brightness, servo angle, motor speed), and sensors return a value to `digitalRead` or
`analogRead`. There is **no circuit solver**: no node voltages, no current through a
resistor, no capacitor charging, no transistor switching.

Tinkercad uses a full circuit solver. Without one, these parts can be placed and wired but
cannot behave correctly: resistor, capacitor, inductor, diode, Zener, transistors, MOSFETs,
555 timer, op-amp, regulators, multimeter, oscilloscope. A part that only looks right would
be the "UI-only placeholder" the requirements rule out, so the solver is a prerequisite
for them.

---

## 3. Circuits catalogue vs Constructa

### Microcontrollers
| Tinkercad | Constructa | Status |
|---|---|---|
| Arduino Uno R3 | `arduino` (GLB). Header exposes D2–D11, 5V, GND, SDA, SCL only. | 🟡 D0, D1, D12, D13, A0–A3, 3.3V and VIN pins missing |
| ATtiny85 (?) | — | ❌ |
| micro:bit | — | ❌ (needs a MakeCode/Python runtime, not Arduino C++) |
| — | `subo`, `esp32` | ✅ extra (not in Tinkercad) |

### Breadboards and wiring
| Tinkercad | Status |
|---|---|
| Breadboard mini, small, full | ❌ (pins exist on parts but nothing joins rows into nets) |
| Wire with colour and bend points | 🟡 wires live in the 2D workbench only; 3D wires turned off (`SHOW_3D_WIRES=false`) |

### Passive components (need the solver, section 2)
| Tinkercad | Status |
|---|---|
| Resistor (value and colour bands) | ❌ |
| Capacitor, polarized/electrolytic capacitor | ❌ |
| Inductor | ❌ |
| Potentiometer | ❌ (can be simulated now as a voltage divider into `analogRead`) |

### Diodes, LEDs and lights
| Tinkercad | Status |
|---|---|
| LED (colours) | ✅ `led` |
| RGB LED (common anode and cathode) | ❌ |
| Diode, Zener diode | ❌ (solver) |
| Photodiode | ❌ |
| Light bulb (incandescent) | ❌ |
| LED bar graph (10 segments) | ❌ |
| NeoPixel strip 4 / 20, ring 12 / 16 / 24, jewel 7 | ❌ (Adafruit_NeoPixel shim needed) |

### Transistors and switching
| Tinkercad | Status |
|---|---|
| NPN, PNP BJT | ❌ (solver) |
| N-channel, P-channel MOSFET | ❌ (solver) |
| Relay SPDT | ❌ |
| Optocoupler 4N35 (?) | ❌ (solver) |

### Inputs and switches
| Tinkercad | Status |
|---|---|
| Pushbutton (4-leg tactile) | ❌ (can be simulated now: click → `digitalRead`) |
| Slide switch SPDT | ❌ (can be simulated now) |
| DIP switch SPST ×4 / ×6 / ×8 | ❌ (can be simulated now) |
| Keypad 4×4 | ❌ (Keypad library shim needed) |
| Tilt sensor (ball switch) | ❌ (can be simulated now from object tilt) |

### Sensors
| Tinkercad | Constructa | Status |
|---|---|---|
| Ultrasonic 4-pin (HC-SR04) | `ultrasonic` | ✅ |
| Ultrasonic 3-pin (PING))) ) | — | ❌ (shared TRIG/ECHO pin) |
| PIR | `pir_sensor` | ✅ |
| Photoresistor (bare LDR) | `ldr_sensor` (module form) | 🟡 bare 2-leg part missing |
| Ambient light sensor (phototransistor) | — | ❌ |
| Temperature sensor TMP36 | — | ❌ (analog, formula known) |
| Flex sensor | — | ❌ |
| Force sensor (FSR) | — | ❌ |
| Soil moisture | `soil_moisture` | ✅ |
| Gas sensor | `gas_sensor` | ✅ |
| IR receiver + IR remote | `ir_sensor` is an obstacle sensor, not a receiver | ❌ (IRremote shim needed) |
| — | DHT11, colour, flame, rain, sound, touch, BMP280, MPU6050, Hall | ✅ extra |

### Outputs, actuators and motors
| Tinkercad | Constructa | Status |
|---|---|---|
| DC motor | `motor_dc` | ✅ |
| Hobby gearmotor | `motor_bo` (TT variant) | ✅ |
| Micro servo / positional micro servo | `servo` (SG90 variant) | ✅ |
| Vibration motor | — | ❌ |
| Piezo | `buzzer` | ✅ |
| — | stepper, FS90R, gripper, encoder motors | ✅ extra |

### Displays
| Tinkercad | Constructa | Status |
|---|---|---|
| LCD 16×2 (parallel) | — | ❌ (LiquidCrystal shim needed) |
| LCD 16×2 I²C | — | ❌ (LiquidCrystal_I2C shim, reuses `utils/i2cSensors.js`) |
| 7-segment display (common anode/cathode) | — | ❌ (can be simulated now from pin levels) |
| — | `oled` 128×64 | ✅ extra |

### Integrated circuits (most need the solver)
| Tinkercad | Status |
|---|---|
| L293D H-bridge | ❌ (can reuse `utils/l298n.js` logic, no solver needed) |
| 74HC595 shift register | ❌ (digital, no solver needed: `shiftOut` model) |
| 555 timer | ❌ (solver) |
| LM741 op-amp (?) | ❌ (solver) |
| 74xx logic gates (7400 NAND, 7402 NOR, 7404 NOT, 7408 AND, 7432 OR, 7486 XOR) (?) | ❌ (digital, no solver needed) |
| 4511 BCD-to-7-segment (?) | ❌ (digital) |
| Voltage regulator 7805 / LM317 (?) | ❌ (solver) |

### Power sources
| Tinkercad | Status |
|---|---|
| 9 V battery | ❌ |
| Coin cell 3 V (CR2032) | ❌ |
| 1.5 V AA/AAA, battery packs 1–4 cells | ❌ |
| Solar cell (?) | ❌ |
| DC power supply (bench) | ❌ |

`robot/BatteryModel.js` and `robot/PowerSystem.js` already model battery sag and current
budget; battery parts should feed them.

### Instruments (need the solver)
| Tinkercad | Status |
|---|---|
| Multimeter (V, A, Ω) | ❌ |
| Function generator | ❌ |
| Oscilloscope | ❌ |

---

## 4. 3D Design catalogue vs Constructa

### Basic shapes
| Tinkercad | Constructa | Status |
|---|---|---|
| Box | `box`, `rectprism` | ✅ |
| Cylinder | `cylinder` | ✅ |
| Sphere | `sphere` | ✅ |
| Cone | `cone` | ✅ |
| Roof | `prism` (triangular) | ✅ |
| Pyramid | `pyramid` | ✅ |
| Torus | `torus` | ✅ |
| Text | `text` | ✅ |
| Polygon (adjustable sides) | `hexagon` (fixed 6 sides) | 🟡 side count not adjustable |
| Star | `star` in the shape list is a torus knot; a real star exists in MechanicalLibrary | 🟡 |
| Half sphere | — | ❌ |
| Round roof | — | ❌ |
| Tube (hollow cylinder) | — | ❌ |
| Wedge | — | ❌ |
| Paraboloid | — | ❌ |
| Icosahedron | — | ❌ |
| Heart | — | ❌ |
| Scribble (freehand → extrude) | SVG import extrudes | ❌ freehand drawing |
| Box hole / cylinder hole | `isHole` toggle on any shape | ✅ |
| Shape parameters (bevel, segments, steps, radius) | partly (fillet tool, dims) | 🟡 no per-shape parameter panel |

### Tools
| Tinkercad | Status |
|---|---|
| Move / rotate / scale gizmo, typed dimensions | ✅ |
| Group, ungroup (CSG with holes) | ✅ |
| Align | ✅ |
| Mirror, duplicate, delete | ✅ |
| Hole / solid | ✅ |
| Workplane (place on any face) | ❌ |
| Ruler | ❌ |
| Notes | ❌ |
| Shape generators (community) | out of scope (user-authored scripts) |

---

## 5. Counts

| Area | ✅ | 🟡 | ❌ |
|---|---|---|---|
| Circuits | 12 | 4 | about 60 (counting each variant) |
| 3D shapes and tools | 17 | 4 | 11 |

## 6. Build order

| Phase | Contents | Needs solver |
|---|---|---|
| 0 | One registry that every type list derives from | no |
| 1 | Full Uno header; pushbutton, slide switch, DIP switch, potentiometer, tilt, keypad 4×4 | no |
| 2 | RGB LED, bar graph, 7-segment, NeoPixel family, light bulb, vibration motor | no |
| 3 | LCD 16×2 (parallel and I²C), TMP36, flex, FSR, ambient light, bare photoresistor, PING))), IR receiver + remote | no |
| 4 | L293D, 74HC595, 74xx gates, 4511, relay | no |
| 5 | Breadboards (row nets), batteries and bench supply feeding PowerSystem | partly |
| 6 | Circuit solver (modified nodal analysis), then resistor, capacitor, inductor, diodes, transistors, MOSFETs, 555, op-amp, regulators, optocoupler, multimeter, oscilloscope, function generator | yes |
| 7 | 3D: half sphere, round roof, tube, wedge, paraboloid, icosahedron, heart, adjustable polygon, real star, shape parameter panel, workplane, ruler, notes, scribble | no |

Each phase ships with tests in `tests/components/`, following `moduleSensors.test.js`.
