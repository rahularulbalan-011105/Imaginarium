// ─────────────────────────────────────────────────────────────────────────────
// The Tinkercad catalogue Constructa is matched against, as data.
//
// SOURCES (rendered in a real browser, 2026-11-27):
//   Circuits — https://www.tinkercad.com/help/circuits/list-of-all-circuit-components
//     ("Component library reference"). Names below are copied verbatim.
//     Tinkercad says this table lists "many of the components available", so it
//     is the official list but not guaranteed exhaustive; the full panel is only
//     visible inside the signed-in editor.
//   3D Design — the help-centre articles under 3D Design (Shapes Panel, Sketch
//     shapes, Workspace Helpers, Workspace Tools, Object Placement, Grouping,
//     Hidden shapes, Blocks, Bricks). The help pages name the sketch shapes,
//     hole/text shapes and every tool, but show the basic solid shapes only as
//     pictures: those entries carry `source: 'panel'` (from the shapes panel as
//     known, not confirmed by a fetched page).
//
// `match` lists the names Constructa parts / tests use for the same item, so a
// part's `tinkercad:` label (or a test group "shape:…", "tool:…", "legacy:…")
// is credited to the official entry. `extra` marks Constructa items that are NOT
// on the official list (kept, but never counted toward Tinkercad coverage).
// ─────────────────────────────────────────────────────────────────────────────

/** @type {{ area:'circuits'|'3d', group:string, name:string, match?:string[], legacy?:string[], source?:string, extra?:boolean }[]} */
export const TINKERCAD_CATALOG = [
  // ── Sensors ────────────────────────────────────────────────────────────────
  { area: 'circuits', group: 'Sensors', name: 'Temperature sensor (TMP36)', match: ['Temperature Sensor [TMP36]'] },
  { area: 'circuits', group: 'Sensors', name: 'Ultrasonic distance sensor (3-pin)', match: ['Ultrasonic Distance Sensor (3-pin PING)'] },
  { area: 'circuits', group: 'Sensors', name: 'Ultrasonic distance sensor (4-pin)', match: ['Ultrasonic Distance Sensor (4-pin)'], legacy: ['ultrasonic'] },
  { area: 'circuits', group: 'Sensors', name: 'Photoresistor' },
  { area: 'circuits', group: 'Sensors', name: 'Photodiode' },
  { area: 'circuits', group: 'Sensors', name: 'Ambient light sensor', match: ['Ambient Light Sensor'] },
  { area: 'circuits', group: 'Sensors', name: 'Flex sensor', match: ['Flex Sensor'] },
  { area: 'circuits', group: 'Sensors', name: 'Force sensor', match: ['Force Sensor'] },
  { area: 'circuits', group: 'Sensors', name: 'IR sensor', match: ['IR Sensor (receiver)'] },
  { area: 'circuits', group: 'Sensors', name: 'IR remote', match: ['IR Remote'] },
  { area: 'circuits', group: 'Sensors', name: 'PIR sensor', match: ['PIR Sensor'], legacy: ['pir_sensor'] },
  { area: 'circuits', group: 'Sensors', name: 'Soil moisture sensor', match: ['Soil Moisture Sensor'], legacy: ['soil_moisture'] },
  { area: 'circuits', group: 'Sensors', name: 'Tilt sensor (2-pin)', match: ['Tilt Sensor'] },
  { area: 'circuits', group: 'Sensors', name: 'Gas sensor', match: ['Gas Sensor'], legacy: ['gas_sensor'] },
  // ── Passive components and controls ────────────────────────────────────────
  { area: 'circuits', group: 'Passive components and controls', name: 'Resistor' },
  { area: 'circuits', group: 'Passive components and controls', name: 'Ceramic capacitor', match: ['Capacitor'] },
  { area: 'circuits', group: 'Passive components and controls', name: 'Polarized capacitor', match: ['Polarized Capacitor'] },
  { area: 'circuits', group: 'Passive components and controls', name: 'Diode' },
  { area: 'circuits', group: 'Passive components and controls', name: 'Zener diode', match: ['Zener Diode'] },
  { area: 'circuits', group: 'Passive components and controls', name: 'Inductor' },
  { area: 'circuits', group: 'Passive components and controls', name: 'Pushbutton' },
  { area: 'circuits', group: 'Passive components and controls', name: 'Potentiometer' },
  { area: 'circuits', group: 'Passive components and controls', name: 'Slideswitch' },
  { area: 'circuits', group: 'Passive components and controls', name: 'DIP switch (DPST)', match: ['DIP Switch DPST'] },
  { area: 'circuits', group: 'Passive components and controls', name: 'DIP switch (SPST x4)', match: ['DIP Switch SPST x4'] },
  { area: 'circuits', group: 'Passive components and controls', name: 'DIP switch (SPST x6)', match: ['DIP Switch SPST x6'] },
  { area: 'circuits', group: 'Passive components and controls', name: 'Keypad 4x4' },
  // ── LEDs, lighting, and displays ───────────────────────────────────────────
  { area: 'circuits', group: 'LEDs, lighting, and displays', name: 'LED', legacy: ['led'] },
  { area: 'circuits', group: 'LEDs, lighting, and displays', name: 'LED RGB', match: ['RGB LED'] },
  { area: 'circuits', group: 'LEDs, lighting, and displays', name: 'Light bulb (automotive)', match: ['Light Bulb'] },
  { area: 'circuits', group: 'LEDs, lighting, and displays', name: 'NeoPixel (single and arrays)', match: ['NeoPixel', 'NeoPixel Strip 4', 'NeoPixel Strip 20', 'NeoPixel Ring 12', 'NeoPixel Ring 16', 'NeoPixel Ring 24', 'NeoPixel Jewel'] },
  { area: 'circuits', group: 'LEDs, lighting, and displays', name: '7 segment display', match: ['7 Segment Display'] },
  { area: 'circuits', group: 'LEDs, lighting, and displays', name: '7 segment clock display' },
  { area: 'circuits', group: 'LEDs, lighting, and displays', name: 'LCD 16x2', match: ['LCD 16 x 2'] },
  { area: 'circuits', group: 'LEDs, lighting, and displays', name: 'LCD 16x2 (I2C)', match: ['LCD 16 x 2 (I2C)'] },
  // ── Motors and actuators ───────────────────────────────────────────────────
  { area: 'circuits', group: 'Motors and actuators', name: 'Vibration motor', match: ['Vibration Motor'] },
  { area: 'circuits', group: 'Motors and actuators', name: 'DC motor', match: ['DC Motor'], legacy: ['motor_dc'] },
  { area: 'circuits', group: 'Motors and actuators', name: 'DC motor with encoder', match: ['DC Motor with Encoder'], legacy: ['motor_enc'] },
  { area: 'circuits', group: 'Motors and actuators', name: 'Micro servos', match: ['Micro Servo'], legacy: ['servo'] },
  { area: 'circuits', group: 'Motors and actuators', name: 'Hobby gearmotor', match: ['Hobby Gearmotor'], legacy: ['motor_bo'] },
  { area: 'circuits', group: 'Motors and actuators', name: 'Piezo', legacy: ['buzzer'] },
  // ── Power ──────────────────────────────────────────────────────────────────
  { area: 'circuits', group: 'Power', name: '9-volt battery', match: ['9V Battery'] },
  { area: 'circuits', group: 'Power', name: '1.5V battery array', match: ['1.5V Battery', 'AA Battery Pack (2xAA)', 'AA Battery Pack (4xAA)'] },
  { area: 'circuits', group: 'Power', name: '3V coin cell battery', match: ['Coin Cell 3V Battery'] },
  { area: 'circuits', group: 'Power', name: 'Solar cell', match: ['Solar Cell'] },
  { area: 'circuits', group: 'Power', name: 'Potato battery' },
  { area: 'circuits', group: 'Power', name: 'Lemon battery' },
  { area: 'circuits', group: 'Power', name: 'Power supply', match: ['Power Supply'] },
  { area: 'circuits', group: 'Power', name: 'LM7805 5V regulator', match: ['Voltage Regulator LM7805'] },
  { area: 'circuits', group: 'Power', name: 'LD1117V33 3.3V regulator' },
  // ── Prototyping and test tools ─────────────────────────────────────────────
  { area: 'circuits', group: 'Prototyping and test tools', name: 'Breadboard (standard, small, mini)', match: ['Breadboard', 'Breadboard Small', 'Breadboard Mini'] },
  { area: 'circuits', group: 'Prototyping and test tools', name: 'Multimeter' },
  { area: 'circuits', group: 'Prototyping and test tools', name: 'Function generator', match: ['Function Generator'] },
  { area: 'circuits', group: 'Prototyping and test tools', name: 'Oscilloscope' },
  { area: 'circuits', group: 'Prototyping and test tools', name: '8-pin header' },
  { area: 'circuits', group: 'Prototyping and test tools', name: 'USB A' },
  // ── Boards and microcontrollers ────────────────────────────────────────────
  { area: 'circuits', group: 'Boards and microcontrollers', name: 'micro:bit' },
  { area: 'circuits', group: 'Boards and microcontrollers', name: 'micro:bit breakout' },
  { area: 'circuits', group: 'Boards and microcontrollers', name: 'Arduino', match: ['Arduino Uno R3'], legacy: ['arduino'] },
  { area: 'circuits', group: 'Boards and microcontrollers', name: 'ATTiny', match: ['ATtiny85'] },
  // ── Semiconductors and ICs ─────────────────────────────────────────────────
  { area: 'circuits', group: 'Semiconductors and ICs', name: '741 op-amp', match: ['Operational Amplifier LM741'] },
  { area: 'circuits', group: 'Semiconductors and ICs', name: '555 timer', match: ['555 Timer'] },
  { area: 'circuits', group: 'Semiconductors and ICs', name: '556 dual timer' },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'LM339 quad comparator' },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'LM393 dual comparator' },
  { area: 'circuits', group: 'Semiconductors and ICs', name: '4N35 optocoupler', match: ['Optocoupler'] },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'NPN transistor (BJT)', match: ['NPN Transistor (BJT)'] },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'PNP transistor (BJT)', match: ['PNP Transistor (BJT)'] },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'nMOS transistor (MOSFET)', match: ['N-Channel MOSFET'] },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'pMOS transistor (MOSFET)', match: ['P-Channel MOSFET'] },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'TIP120 Darlington NPN transistor' },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'Relay SPDT' },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'Relay DPDT' },
  { area: 'circuits', group: 'Semiconductors and ICs', name: 'L293D H-bridge motor driver', match: ['H-bridge Motor Driver L293D'] },
  // ── Logic gates and digital ICs ────────────────────────────────────────────
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC00 – quad NAND gate', match: ['Quad NAND Gate 74HC00'] },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC02 – quad NOR gate', match: ['Quad NOR Gate 74HC02'] },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC08 – quad AND gate', match: ['Quad AND Gate 74HC08'] },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC32 – quad OR gate', match: ['Quad OR Gate 74HC32'] },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC86 – quad XOR gate', match: ['Quad XOR Gate 74HC86'] },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC04 – hex inverter', match: ['Hex Inverter 74HC04'] },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC14 – hex inverter (Schmitt trigger)' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC132 – quad NAND Schmitt trigger' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC10 – triple 3-input NAND gate' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC11 – triple 3-input AND gate' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC27 – triple 3-input NOR gate' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC20 – dual 4-input NAND gate' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC21 – dual 4-input AND gate' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC73 – dual JK flip-flop' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC74 – dual D flip-flop' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC75 – 4-bit latch' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC93 – 4-bit binary counter' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC283 – 4-bit adder' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC595 – 8-bit shift register', match: ['Shift Register 74HC595'] },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: '74HC4017 – Johnson decade counter' },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: 'CD4511 – 7-segment decoder', match: ['BCD to 7-Segment Decoder CD4511'] },
  { area: 'circuits', group: 'Logic gates and digital ICs', name: 'PCF8574 – 8-port I2C expander' },
  // ── Constructa extras (real parts, not on Tinkercad's list — not counted) ──
  { area: 'circuits', group: 'Constructa extras', name: 'LM317 adjustable regulator', match: ['Voltage Regulator LM317'], extra: true },
  { area: 'circuits', group: 'Constructa extras', name: 'DIP switch (SPST x8)', match: ['DIP Switch SPST x8'], extra: true },

  // ── 3D Design: Basic Shapes (solid shapes from the panel; holes, text and
  //    sketch shapes named in the help centre) ──────────────────────────────
  ...['Box', 'Cylinder', 'Sphere', 'Roof', 'Cone', 'Round Roof', 'Star', 'Heart', 'Half Sphere', 'Polygon', 'Icosahedron', 'Paraboloid', 'Torus', 'Tube', 'Wedge', 'Pyramid']
    .map((name) => ({ area: '3d', group: 'Basic solid shapes', name, source: 'panel' })),
  { area: '3d', group: 'Basic hole shapes', name: 'Box Hole' },
  { area: '3d', group: 'Basic hole shapes', name: 'Cylinder Hole' },
  { area: '3d', group: 'Text', name: 'Text' },
  { area: '3d', group: 'Text', name: 'Text font selection' },
  { area: '3d', group: 'Sketch shapes', name: 'Scribble' },
  { area: '3d', group: 'Sketch shapes', name: 'Extrude Sketch' },
  { area: '3d', group: 'Sketch shapes', name: 'Revolve Sketch' },
  // ── 3D Design: tools (help centre article names) ─────────────────────────
  { area: '3d', group: 'Workspace Helpers', name: 'Workplane' },
  { area: '3d', group: 'Workspace Helpers', name: 'Ruler' },
  { area: '3d', group: 'Workspace Helpers', name: 'Notes' },
  { area: '3d', group: 'Workspace Tools', name: 'Copy / Paste' },
  { area: '3d', group: 'Workspace Tools', name: 'Duplicate', match: ['Duplicate'] },
  { area: '3d', group: 'Workspace Tools', name: 'Duplicate and Repeat' },
  { area: '3d', group: 'Workspace Tools', name: 'Delete' },
  { area: '3d', group: 'Workspace Tools', name: 'Undo and Redo' },
  { area: '3d', group: 'Object Placement', name: 'Align' },
  { area: '3d', group: 'Object Placement', name: 'Mirror', match: ['Mirror / Flip'] },
  { area: '3d', group: 'Object Placement', name: 'Cruise' },
  { area: '3d', group: 'Object Placement', name: 'Drop to Workplane' },
  { area: '3d', group: 'Object Placement', name: 'Shape Workplane' },
  { area: '3d', group: 'Object Placement', name: 'Measure' },
  { area: '3d', group: 'Grouping', name: 'Union Group', match: ['Group / Ungroup'] },
  { area: '3d', group: 'Grouping', name: 'Bundle Group' },
  { area: '3d', group: 'Grouping', name: 'Intersect Group' },
  { area: '3d', group: 'Grouping', name: 'Ungroup', match: ['Group / Ungroup'] },
  { area: '3d', group: 'Grouping', name: 'Hole / Solid', match: ['Hole / Solid'] },
  { area: '3d', group: 'Hidden shapes', name: 'Hide / Show shapes' },
  { area: '3d', group: 'Views', name: 'Blocks' },
  { area: '3d', group: 'Views', name: 'Bricks' },
]
