// ─────────────────────────────────────────────────────────────────────────────
// The Tinkercad catalogue Constructa is matching, as data. Each entry names the
// Constructa type(s) that implement it: a catalogue part (src/parts/catalog —
// it carries the same name in its `tinkercad` field), or a hand-built legacy
// part. The parts dashboard (tools/parts-dashboard.mjs) reads this to show
// what is implemented and tested, and what is still missing.
//
// Source: the Tinkercad Circuits component panel and the 3D Design shape panel.
// Tinkercad's own catalogue page is JavaScript-rendered and could not be
// fetched; entries marked `verify: true` are the least certain and should be
// checked against the in-app search.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {{ area:'circuits'|'3d', group:string, name:string, legacy?:string[], verify?:boolean }[]} */
export const TINKERCAD_CATALOG = [
  // ── Circuits: microcontrollers ────────────────────────────────────────────
  { area: 'circuits', group: 'Microcontrollers', name: 'Arduino Uno R3', legacy: ['arduino'] },
  { area: 'circuits', group: 'Microcontrollers', name: 'ATtiny85', verify: true },
  { area: 'circuits', group: 'Microcontrollers', name: 'micro:bit' },
  // ── Breadboards ────────────────────────────────────────────────────────────
  { area: 'circuits', group: 'Breadboards', name: 'Breadboard Mini' },
  { area: 'circuits', group: 'Breadboards', name: 'Breadboard Small' },
  { area: 'circuits', group: 'Breadboards', name: 'Breadboard' },
  // ── General / passive ──────────────────────────────────────────────────────
  { area: 'circuits', group: 'General', name: 'Resistor' },
  { area: 'circuits', group: 'General', name: 'Capacitor' },
  { area: 'circuits', group: 'General', name: 'Polarized Capacitor' },
  { area: 'circuits', group: 'General', name: 'Inductor' },
  { area: 'circuits', group: 'General', name: 'Potentiometer' },
  { area: 'circuits', group: 'General', name: 'Diode' },
  { area: 'circuits', group: 'General', name: 'Zener Diode' },
  { area: 'circuits', group: 'General', name: 'NPN Transistor (BJT)' },
  { area: 'circuits', group: 'General', name: 'PNP Transistor (BJT)' },
  { area: 'circuits', group: 'General', name: 'N-Channel MOSFET' },
  { area: 'circuits', group: 'General', name: 'P-Channel MOSFET' },
  { area: 'circuits', group: 'General', name: 'Relay SPDT' },
  { area: 'circuits', group: 'General', name: 'Optocoupler', verify: true },
  // ── Inputs ─────────────────────────────────────────────────────────────────
  { area: 'circuits', group: 'Inputs', name: 'Pushbutton' },
  { area: 'circuits', group: 'Inputs', name: 'Slideswitch' },
  { area: 'circuits', group: 'Inputs', name: 'DIP Switch SPST x4' },
  { area: 'circuits', group: 'Inputs', name: 'DIP Switch SPST x6' },
  { area: 'circuits', group: 'Inputs', name: 'DIP Switch SPST x8' },
  { area: 'circuits', group: 'Inputs', name: 'Keypad 4x4' },
  { area: 'circuits', group: 'Inputs', name: 'Tilt Sensor' },
  { area: 'circuits', group: 'Inputs', name: 'Photoresistor' },
  { area: 'circuits', group: 'Inputs', name: 'Photodiode' },
  { area: 'circuits', group: 'Inputs', name: 'Ambient Light Sensor' },
  { area: 'circuits', group: 'Inputs', name: 'Temperature Sensor [TMP36]' },
  { area: 'circuits', group: 'Inputs', name: 'Flex Sensor' },
  { area: 'circuits', group: 'Inputs', name: 'Force Sensor' },
  { area: 'circuits', group: 'Inputs', name: 'PIR Sensor', legacy: ['pir_sensor'] },
  { area: 'circuits', group: 'Inputs', name: 'Ultrasonic Distance Sensor (4-pin)', legacy: ['ultrasonic'] },
  { area: 'circuits', group: 'Inputs', name: 'Ultrasonic Distance Sensor (3-pin PING)' },
  { area: 'circuits', group: 'Inputs', name: 'Soil Moisture Sensor', legacy: ['soil_moisture'] },
  { area: 'circuits', group: 'Inputs', name: 'Gas Sensor', legacy: ['gas_sensor'] },
  { area: 'circuits', group: 'Inputs', name: 'IR Sensor (receiver)' },
  { area: 'circuits', group: 'Inputs', name: 'IR Remote' },
  // ── Outputs ────────────────────────────────────────────────────────────────
  { area: 'circuits', group: 'Outputs', name: 'LED', legacy: ['led'] },
  { area: 'circuits', group: 'Outputs', name: 'RGB LED' },
  { area: 'circuits', group: 'Outputs', name: 'Light Bulb' },
  { area: 'circuits', group: 'Outputs', name: 'LED Bar Graph' },
  { area: 'circuits', group: 'Outputs', name: 'NeoPixel' },
  { area: 'circuits', group: 'Outputs', name: 'NeoPixel Strip 4' },
  { area: 'circuits', group: 'Outputs', name: 'NeoPixel Strip 20' },
  { area: 'circuits', group: 'Outputs', name: 'NeoPixel Ring 12' },
  { area: 'circuits', group: 'Outputs', name: 'NeoPixel Ring 16' },
  { area: 'circuits', group: 'Outputs', name: 'NeoPixel Ring 24' },
  { area: 'circuits', group: 'Outputs', name: 'NeoPixel Jewel' },
  { area: 'circuits', group: 'Outputs', name: '7 Segment Display' },
  { area: 'circuits', group: 'Outputs', name: 'LCD 16 x 2' },
  { area: 'circuits', group: 'Outputs', name: 'LCD 16 x 2 (I2C)' },
  { area: 'circuits', group: 'Outputs', name: 'Piezo', legacy: ['buzzer'] },
  { area: 'circuits', group: 'Outputs', name: 'Vibration Motor' },
  { area: 'circuits', group: 'Outputs', name: 'DC Motor', legacy: ['motor_dc'] },
  { area: 'circuits', group: 'Outputs', name: 'Hobby Gearmotor', legacy: ['motor_bo'] },
  { area: 'circuits', group: 'Outputs', name: 'Micro Servo', legacy: ['servo'] },
  { area: 'circuits', group: 'Outputs', name: 'Positional Micro Servo', legacy: ['servo'] },
  // ── Integrated circuits / power control / logic ───────────────────────────
  { area: 'circuits', group: 'ICs', name: '555 Timer' },
  { area: 'circuits', group: 'ICs', name: 'Shift Register 74HC595' },
  { area: 'circuits', group: 'ICs', name: 'H-bridge Motor Driver L293D' },
  { area: 'circuits', group: 'ICs', name: 'Operational Amplifier LM741', verify: true },
  { area: 'circuits', group: 'ICs', name: 'Voltage Regulator LM7805', verify: true },
  { area: 'circuits', group: 'ICs', name: 'Voltage Regulator LM317', verify: true },
  { area: 'circuits', group: 'ICs', name: 'BCD to 7-Segment Decoder CD4511', verify: true },
  { area: 'circuits', group: 'Logic', name: 'Quad NAND Gate 74HC00', verify: true },
  { area: 'circuits', group: 'Logic', name: 'Quad NOR Gate 74HC02', verify: true },
  { area: 'circuits', group: 'Logic', name: 'Hex Inverter 74HC04', verify: true },
  { area: 'circuits', group: 'Logic', name: 'Quad AND Gate 74HC08', verify: true },
  { area: 'circuits', group: 'Logic', name: 'Quad OR Gate 74HC32', verify: true },
  { area: 'circuits', group: 'Logic', name: 'Quad XOR Gate 74HC86', verify: true },
  // ── Power ──────────────────────────────────────────────────────────────────
  { area: 'circuits', group: 'Power', name: '9V Battery' },
  { area: 'circuits', group: 'Power', name: 'Coin Cell 3V Battery' },
  { area: 'circuits', group: 'Power', name: '1.5V Battery' },
  { area: 'circuits', group: 'Power', name: 'AA Battery Pack (2xAA)' },
  { area: 'circuits', group: 'Power', name: 'AA Battery Pack (4xAA)' },
  { area: 'circuits', group: 'Power', name: 'Solar Cell', verify: true },
  { area: 'circuits', group: 'Power', name: 'Power Supply' },
  // ── Instruments ────────────────────────────────────────────────────────────
  { area: 'circuits', group: 'Instruments', name: 'Multimeter' },
  { area: 'circuits', group: 'Instruments', name: 'Function Generator' },
  { area: 'circuits', group: 'Instruments', name: 'Oscilloscope' },

  // ── 3D Design: basic shapes ───────────────────────────────────────────────
  { area: '3d', group: 'Basic Shapes', name: 'Box', legacy: ['box'] },
  { area: '3d', group: 'Basic Shapes', name: 'Cylinder', legacy: ['cylinder'] },
  { area: '3d', group: 'Basic Shapes', name: 'Sphere', legacy: ['sphere'] },
  { area: '3d', group: 'Basic Shapes', name: 'Scribble' },
  { area: '3d', group: 'Basic Shapes', name: 'Roof', legacy: ['prism'] },
  { area: '3d', group: 'Basic Shapes', name: 'Cone', legacy: ['cone'] },
  { area: '3d', group: 'Basic Shapes', name: 'Round Roof' },
  { area: '3d', group: 'Basic Shapes', name: 'Text', legacy: ['text'] },
  { area: '3d', group: 'Basic Shapes', name: 'Star' },
  { area: '3d', group: 'Basic Shapes', name: 'Heart' },
  { area: '3d', group: 'Basic Shapes', name: 'Half Sphere' },
  { area: '3d', group: 'Basic Shapes', name: 'Polygon' },
  { area: '3d', group: 'Basic Shapes', name: 'Icosahedron' },
  { area: '3d', group: 'Basic Shapes', name: 'Paraboloid' },
  { area: '3d', group: 'Basic Shapes', name: 'Torus', legacy: ['torus'] },
  { area: '3d', group: 'Basic Shapes', name: 'Tube' },
  { area: '3d', group: 'Basic Shapes', name: 'Wedge' },
  { area: '3d', group: 'Basic Shapes', name: 'Pyramid', legacy: ['pyramid'] },
  { area: '3d', group: 'Basic Shapes', name: 'Box Hole', legacy: ['box'] },
  { area: '3d', group: 'Basic Shapes', name: 'Cylinder Hole', legacy: ['cylinder'] },
  // ── 3D Design: tools ──────────────────────────────────────────────────────
  { area: '3d', group: 'Tools', name: 'Workplane' },
  { area: '3d', group: 'Tools', name: 'Ruler' },
  { area: '3d', group: 'Tools', name: 'Notes' },
  { area: '3d', group: 'Tools', name: 'Align', legacy: ['align'] },
  { area: '3d', group: 'Tools', name: 'Mirror / Flip', legacy: ['mirror'] },
  { area: '3d', group: 'Tools', name: 'Group / Ungroup', legacy: ['group'] },
  { area: '3d', group: 'Tools', name: 'Duplicate', legacy: ['duplicate'] },
  { area: '3d', group: 'Tools', name: 'Hole / Solid', legacy: ['hole'] },
]
