// Shared wiring vocabulary for every wiring view (Pick a Pin, Workbench, 3D).
//
// There is ONE connection list — electronicsStore.connections:
//   connId → { fromPinId: 'compId:PIN', toPinId: 'compId:PIN', color? }
// Every view reads and writes that list; nothing keeps its own copy. `color` is
// optional — without it a wire is coloured by its electrical role.

export const ELEC_TYPES = new Set(['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo', 'ir_sensor', 'ultrasonic', 'buzzer', 'oled', 'gas_sensor', 'color_sensor', 'ldr_sensor', 'dht11'])

export const PIN_DEFS = {
  arduino:  ['D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','5V','GND1','GND2'],
  // Official Subo IO header (Subo.h): IO1..IO21 + power rails. Matches SUBO_PIN_ORDER in
  // electronicsFactory so these map to the same pinIds as the 3D pin spheres.
  subo:     ['IO1','IO2','IO3','IO4','IO5','IO6','IO7','IO8','IO9','IO10','IO11','IO12','IO13','IO14','IO15','IO16','IO17','IO18','IO19','IO20','IO21','5V','GND1','GND2'],
  motor:    ['TERM_A','TERM_B'],
  motor_bo: ['TERM_A','TERM_B'],
  motor_dc: ['TERM_A','TERM_B'],
  led:      ['ANODE','CATHODE'],
  servo:    ['SIGNAL','VCC','GND'],
  ir_sensor:  ['OUT','GND','VCC'],
  ultrasonic: ['VCC','TRIG','ECHO','GND'],
  buzzer:     ['SIGNAL','GND'],
  oled:       ['GND','VCC','SCL','SDA'],
  gas_sensor: ['VCC','GND','DO','AO'],
  color_sensor: ['VCC','GND','S0','S1','S2','S3','OUT'],
  ldr_sensor:   ['VCC','GND','AO','DO'],
  dht11:        ['VCC','GND','DATA'],
}

/** 'power' | 'gnd' | 'signal' for a pin name. */
export function pinRole(pin) {
  if (/^(5V|3V3|VCC|VIN|ANODE)$/i.test(pin)) return 'power'
  if (/^(GND\d*|CATHODE)$/i.test(pin)) return 'gnd'
  return 'signal'
}

export const ROLE_COLORS = { power: '#ef4444', gnd: '#1f2937' }
// Distinct signal colours (no red / near-black so they never read as power/ground).
export const SIGNAL_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#06b6d4', '#ec4899', '#eab308', '#14b8a6']
export const ROLE_LABEL = { power: 'Power', gnd: 'GND', signal: 'Signal' }

const pinOf = (pinId) => (pinId ?? '').split(':')[1] ?? ''
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }

/** Electrical role of a connection: GND wins, then power, else signal. */
export function connectionRole(conn) {
  const roles = [pinRole(pinOf(conn.fromPinId)), pinRole(pinOf(conn.toPinId))]
  if (roles.includes('gnd')) return 'gnd'
  if (roles.includes('power')) return 'power'
  return 'signal'
}

/** { role, color, label } for a connection — the same answer in every view. */
export function wireStyle(connId, conn) {
  const role = connectionRole(conn)
  const color = conn.color || ROLE_COLORS[role] || SIGNAL_COLORS[hash(connId) % SIGNAL_COLORS.length]
  return { role, color, label: ROLE_LABEL[role] }
}

/** 'Arduino_1 · D9' for a pin id. */
export function friendlyPin(pinId, objects) {
  if (!pinId) return '?'
  const [compId, pin] = pinId.split(':')
  const comp = objects.find(o => o.id === compId)
  return `${comp?.name ?? compId} · ${pin}`
}

/** True if this exact pair is already wired (either direction). */
export function isDuplicate(connections, a, b) {
  return Object.values(connections).some(c =>
    (c.fromPinId === a && c.toPinId === b) || (c.fromPinId === b && c.toPinId === a))
}
