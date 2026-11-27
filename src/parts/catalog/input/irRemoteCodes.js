// NEC codes of the common 21-key "Car MP3" / Elegoo / Tinkercad IR remote
// (NEC address 0x00). Helper module for irRemote.part.js and the receiver —
// deliberately NOT a .part.js file.
//
// An NEC frame is 32 bits sent LSB first: address, ~address, command, ~command.
//   IRremote ≥3 decodedRawData (LSB-first word):  ~cmd<<24 | cmd<<16 | ~addr<<8 | addr
//   IRremote 2.x results.value (MSB-first word):  bit-reverse of the above
// e.g. POWER: command 0x45 → raw 0xBA45FF00, classic value 0x00FFA25D.

export const NEC_ADDRESS = 0x00

/** Button grid as printed on the remote, top to bottom. */
export const REMOTE_ROWS = [
  ['PWR', 'VOL+', 'FUNC'],
  ['|<<', '>||', '>>|'],
  ['DOWN', 'VOL-', 'UP'],
  ['0', 'EQ', 'REPT'],
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

/** NEC command byte of each button. */
export const NEC_COMMANDS = {
  PWR: 0x45, 'VOL+': 0x46, FUNC: 0x47,
  '|<<': 0x44, '>||': 0x40, '>>|': 0x43,
  DOWN: 0x07, 'VOL-': 0x15, UP: 0x09,
  0: 0x16, EQ: 0x19, REPT: 0x0D,
  1: 0x0C, 2: 0x18, 3: 0x5E,
  4: 0x08, 5: 0x1C, 6: 0x5A,
  7: 0x42, 8: 0x52, 9: 0x4A,
}

const rev8 = (b) => { let r = 0; for (let i = 0; i < 8; i++) r = (r << 1) | ((b >> i) & 1); return r }

/** The two 32-bit spellings of one NEC frame. */
export function necFrame(addr, cmd) {
  const a = addr & 0xff, c = cmd & 0xff
  const raw = (((~c & 0xff) << 24) | (c << 16) | ((~a & 0xff) << 8) | a) >>> 0
  const value = ((rev8(a) << 24) | (rev8(~a & 0xff) << 16) | (rev8(c) << 8) | rev8(~c & 0xff)) >>> 0
  return { raw, value }
}
