// Waveshare 2.8inch Capacitive Touch LCD — 240×320 ST7789 TFT (SPI) with a
// CST328 capacitive touch controller (I2C). ONE pin table, shared by the 3D
// model (tools/models/tft28.model.js), the 3D pin spheres (electronicsFactory
// TFT28_PINS), the wiring UI (utils/wiring.js) and the Workbench card.
//
// Pins are the 13-pin GH1.25 "Interface 2" in Waveshare's order (VCC first).
// The 18-pin FPC "Interface 1" carries the same signals and is not wired
// separately here. MISO is on the connector but NOT connected on this module
// (the panel is write-only) — kept so the header matches the hardware.
export const TFT28_PINS_TABLE = [
  { name: 'VCC',     role: 'power',   desc: '3.3 V or 5 V — match the board’s logic level' },
  { name: 'GND',     role: 'gnd',     desc: 'Ground' },
  { name: 'MISO',    role: 'digital', desc: 'SPI data out — not connected on this module' },
  { name: 'MOSI',    role: 'digital', desc: 'SPI data in (LCD)' },
  { name: 'SCLK',    role: 'digital', desc: 'SPI clock' },
  { name: 'LCD_CS',  role: 'digital', desc: 'LCD chip select, active low' },
  { name: 'LCD_DC',  role: 'digital', desc: 'Data / command: low = command, high = data' },
  { name: 'LCD_RST', role: 'digital', desc: 'LCD reset, active low' },
  { name: 'LCD_BL',  role: 'pwm',     desc: 'Backlight — PWM sets the brightness' },
  { name: 'TP_SDA',  role: 'digital', desc: 'Touch I2C data' },
  { name: 'TP_SCL',  role: 'digital', desc: 'Touch I2C clock' },
  { name: 'TP_INT',  role: 'digital', desc: 'Touch interrupt' },
  { name: 'TP_RST',  role: 'digital', desc: 'Touch reset, active low' },
]
export const TFT28_PIN_ORDER = TFT28_PINS_TABLE.map((p) => p.name)

// GH1.25 geometry in the model frame (mm): pin i sits at x = x0 − i·pitch, its
// mouth facing +z (the thick-bezel end of the module).
export const TFT28_GH = { x0: 8.45, pitch: 1.25, mouthZ: 30.2, mouthY: 1.95 }
