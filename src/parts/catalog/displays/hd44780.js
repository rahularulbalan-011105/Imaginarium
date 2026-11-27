// HD44780 character-LCD controller, shared by "LCD 16 x 2" (parallel) and
// "LCD 16 x 2 (I2C)" (PCF8574 backpack). Not a part file (no .part.js).
//
// The sandbox libraries (LiquidCrystal / LiquidCrystal_I2C) do exactly what
// the real libraries do on the wires: nibble or byte transfers with RS = 0
// (instruction) or 1 (data). This module is the controller on the other end:
// power-on reset to 8-bit / 1-line / display OFF, the 4-bit nibble assembler
// (lines D0–D3 float HIGH through the chip's pull-ups when only D4–D7 are
// wired), the instruction set, DDRAM (2 × 40 bytes), CGRAM (8 custom
// characters), address counter, entry mode and display shift. Text that the
// screen shows is derived from DDRAM, so wrong wiring or a missing begin()
// gives the same blank or garbled screen as real hardware.

/** Power-on state (HD44780U datasheet "Initializing by internal reset circuit"). */
export function hdReset(cols = 16, rows = 2) {
  return {
    cols, rows,
    ddram: new Array(128).fill(0x20), cgram: new Array(64).fill(0),
    ac: 0, cg: false, cgAddr: 0, id: 1, s: 0,
    displayOn: false, cursorOn: false, blinkOn: false, shift: 0,
    eightBit: true, twoLine: false, font5x10: false, pending: null,
    writes: 0, text: Array.from({ length: rows }, () => ' '.repeat(cols)), powered: false,
  }
}
/** Put a fresh controller into an existing partState object (keeps the object identity). */
export function hdResetInto(st, cols = 16, rows = 2) {
  for (const k of Object.keys(st)) delete st[k]
  return Object.assign(st, hdReset(cols, rows))
}

// DDRAM address arithmetic: 2-line mode has two 40-byte lines at 0x00 and 0x40.
function advance(st, a, dir) {
  if (st.twoLine) {
    let line = a >= 0x40 ? 1 : 0, off = (a & 0x3f) + dir
    if (off > 39) { off = 0; line ^= 1 } else if (off < 0) { off = 39; line ^= 1 }
    return line * 0x40 + off
  }
  return (a + dir + 80) % 80
}

/** Execute one 8-bit instruction (RS = 0) or data byte (RS = 1). */
export function hdExec(st, rs, b) {
  b &= 0xff
  st.writes++
  if (rs) {
    if (st.cg) { st.cgram[st.cgAddr] = b & 0x1f; st.cgAddr = (st.cgAddr + (st.id ? 1 : -1) + 64) & 63 }
    else {
      st.ddram[st.ac] = b
      st.ac = advance(st, st.ac, st.id ? 1 : -1)
      if (st.s) st.shift += st.id ? 1 : -1
    }
    return
  }
  if (b & 0x80) { st.cg = false; st.ac = b & 0x7f; return }
  if (b & 0x40) { st.cg = true; st.cgAddr = b & 0x3f; return }
  if (b & 0x20) { st.eightBit = !!(b & 0x10); st.twoLine = !!(b & 0x08); st.font5x10 = !!(b & 0x04); st.pending = null; return }
  if (b & 0x10) {
    const right = !!(b & 0x04)
    if (b & 0x08) st.shift += right ? -1 : 1          // display shift: right moves the text right
    else st.ac = advance(st, st.ac, right ? 1 : -1)
    return
  }
  if (b & 0x08) { st.displayOn = !!(b & 0x04); st.cursorOn = !!(b & 0x02); st.blinkOn = !!(b & 0x01); return }
  if (b & 0x04) { st.id = (b & 0x02) ? 1 : 0; st.s = b & 0x01; return }
  if (b & 0x02) { st.ac = 0; st.cg = false; st.shift = 0; return }
  if (b & 0x01) { st.ddram.fill(0x20); st.ac = 0; st.cg = false; st.shift = 0; st.id = 1 }
}

/**
 * One bus transfer as the controller sees it. width 4 = only D4–D7 carry the
 * value (a nibble); width 8 = all eight lines carry a byte.
 */
export function hdTransfer(st, rs, value, width) {
  if (width === 4) {
    const nib = value & 0x0f
    if (st.eightBit) { hdExec(st, rs, (nib << 4) | 0x0f); return }   // D0–D3 pulled HIGH
    if (st.pending == null) { st.pending = nib; return }
    const b = (st.pending << 4) | nib
    st.pending = null
    hdExec(st, rs, b)
    return
  }
  if (st.eightBit) hdExec(st, rs, value)
  else hdTransfer(st, rs, (value >> 4) & 0x0f, 4)                // only D4–D7 are read in 4-bit mode
}

// Character generator ROM A00 (the common Japanese ROM): ASCII 0x20–0x7D with ¥ at 0x5C.
export function romChar(code) {
  if (code < 16) return String.fromCharCode(code & 7)      // CGRAM characters 0–7 (8–15 mirror them)
  if (code === 0x5c) return '¥'
  if (code === 0x7e) return '→'
  if (code === 0x7f) return '←'
  if (code >= 0x20 && code < 0x7e) return String.fromCharCode(code)
  return code === 0xff ? '█' : code >= 0xa0 ? '・' : ' '
}

/** The character codes visible in each row (window into DDRAM after the display shift). */
export function hdVisible(st) {
  const rows = []
  for (let r = 0; r < st.rows; r++) {
    const row = []
    for (let c = 0; c < st.cols; c++) {
      let code = 0x20
      if (st.twoLine) {
        if (r < 2) code = st.ddram[r * 0x40 + (((c + st.shift) % 40) + 40) % 40]
        // rows 2–3 of a 20×4 would be the second half of each line; a 16×2 has none.
      } else if (r === 0) code = st.ddram[(((c + st.shift) % 80) + 80) % 80]
      row.push(code)
    }
    rows.push(row)
  }
  return rows
}
export function hdUpdateText(st) {
  st.text = hdVisible(st).map(row => row.map(romChar).join(''))
  return st.text
}

/** Apply a flat transfer list [width, rs, value, width, rs, value, …]. */
export function hdApply(st, list) {
  for (let i = 0; i + 2 < list.length; i += 3) hdTransfer(st, list[i + 1] ? 1 : 0, Number(list[i + 2]) || 0, Number(list[i]) === 4 ? 4 : 8)
  hdUpdateText(st)
}

// ── Screen rendering (canvas texture; skipped where there is no DOM) ─────────
const PX = 4                         // canvas px per LCD dot
export function lcdCanvas(root) {
  if (typeof document === 'undefined') return null
  if (root.userData.lcdCanvas) return root.userData.lcdCanvas
  const c = document.createElement('canvas')
  c.width = 16 * 6 * PX + PX * 2; c.height = 2 * 9 * PX + PX * 2
  root.userData.lcdCanvas = c
  return c
}
/** Draw the 16×2 grid. look = { st, on, backlight 0…1, contrast 0…1 }. Returns true if redrawn. */
export function drawLcd(canvas, look, prevKey) {
  const { st, on, backlight, contrast } = look
  const key = JSON.stringify([on && st?.displayOn, st?.text, st?.cgram, Math.round(backlight * 20), Math.round(contrast * 20)])
  if (key === prevKey) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const bl = Math.max(0, Math.min(1, backlight))
  // Blue STN panel: dark blue unlit, bright blue lit; pixels white.
  const bg = `rgb(${Math.round(10 + 30 * bl)},${Math.round(20 + 90 * bl)},${Math.round(60 + 190 * bl)})`
  ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const show = on && st?.displayOn && contrast > 0.05
  const dotOn = `rgba(235,240,255,${(0.25 + 0.75 * bl) * Math.min(1, contrast)})`
  const dotOff = `rgba(255,255,255,${0.04 + 0.05 * Math.max(0, contrast - 0.8)})`
  const codes = st ? hdVisible(st) : [[], []]
  for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
    const x0 = PX + c * 6 * PX, y0 = PX + r * 9 * PX
    // Cell background (the faint 5×8 dot grid you see on a real panel).
    ctx.fillStyle = dotOff
    for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) ctx.fillRect(x0 + x * PX, y0 + y * PX, PX - 1, PX - 1)
    if (!show) continue
    const code = codes[r]?.[c] ?? 0x20
    ctx.fillStyle = dotOn
    if (code < 16) {
      const base = (code & 7) * 8
      for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) if ((st.cgram[base + y] >> (4 - x)) & 1) ctx.fillRect(x0 + x * PX, y0 + y * PX, PX - 1, PX - 1)
    } else if (code !== 0x20) {
      ctx.font = `bold ${7 * PX}px monospace`; ctx.textBaseline = 'top'; ctx.textAlign = 'center'
      ctx.fillText(romChar(code), x0 + 2.5 * PX, y0 + 0.3 * PX, 5 * PX)
    }
  }
  return key
}

/** Update the 'screen' mesh of an LCD model from its controller state. */
export function lcdVisual(root, look, setGlow, makeTexture) {
  const screen = root.getObjectByName('screen')
  if (!screen) return
  const canvas = lcdCanvas(root)
  if (!canvas) { setGlow(screen, 0x3a7bff, look.on ? look.backlight * 0.3 : 0); return }
  setGlow(screen, 0xffffff, look.on ? 0.15 + look.backlight * 0.3 : 0.05)
  const key = drawLcd(canvas, look, root.userData.lcdKey)
  if (key == null) return
  root.userData.lcdKey = key
  if (!screen.material.map) {
    const t = makeTexture(canvas)
    screen.material.map = t; screen.material.emissiveMap = t
    screen.material.color?.set?.(0xffffff)
  }
  screen.material.map.needsUpdate = true
  screen.material.needsUpdate = true
}

/**
 * The shared Print/LiquidCrystal text API as ES5 source for a sandbox
 * prototype. The class must define _cmd(b), _data(b) (queue a transfer) and
 * _flush() (send the queue).
 */
export function lcdTextApiSource() {
  return `
  clear: function () { this._cmd(0x01); this._flush(); },
  home: function () { this._cmd(0x02); this._flush(); },
  setCursor: function (col, row) {
    var off = [0x00, 0x40, 0x00 + this._cols, 0x40 + this._cols];
    row = Math.floor(Number(row) || 0); if (row >= 4) row = 3; if (row >= this._lines) row = this._lines - 1; if (row < 0) row = 0;
    this._cmd(0x80 | ((Math.floor(Number(col) || 0) + off[row]) & 0x7f)); this._flush();
  },
  _ctrl: function () { this._cmd(0x08 | this._dc); this._flush(); },
  noDisplay: function () { this._dc &= ~0x04; this._ctrl(); },
  display: function () { this._dc |= 0x04; this._ctrl(); },
  noCursor: function () { this._dc &= ~0x02; this._ctrl(); },
  cursor: function () { this._dc |= 0x02; this._ctrl(); },
  noBlink: function () { this._dc &= ~0x01; this._ctrl(); },
  blink: function () { this._dc |= 0x01; this._ctrl(); },
  scrollDisplayLeft: function () { this._cmd(0x18); this._flush(); },
  scrollDisplayRight: function () { this._cmd(0x1C); this._flush(); },
  _mode: function () { this._cmd(0x04 | this._dm); this._flush(); },
  leftToRight: function () { this._dm |= 0x02; this._mode(); },
  rightToLeft: function () { this._dm &= ~0x02; this._mode(); },
  autoscroll: function () { this._dm |= 0x01; this._mode(); },
  noAutoscroll: function () { this._dm &= ~0x01; this._mode(); },
  createChar: function (loc, map) {
    loc = Number(loc) & 7; this._cmd(0x40 | (loc << 3));
    for (var i = 0; i < 8; i++) this._data(map && map[i] != null ? Number(map[i]) : 0);
    this._flush();
  },
  command: function (b) { this._cmd(Number(b) & 255); this._flush(); },
  write: function (v) {
    if (typeof v === 'string') { for (var i = 0; i < v.length; i++) this._data(v.charCodeAt(i) & 255); this._flush(); return v.length; }
    this._data(Number(v) & 255); this._flush(); return 1;
  },
  _str: function (v, f) {
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v == null) return '';
    if (typeof v === 'number') {
      if (!isFinite(v)) return isNaN(v) ? 'nan' : 'inf';
      if (Number.isInteger(v)) {
        if (f === 2 || f === 8 || f === 16) return (v < 0 ? (v >>> 0) : v).toString(f).toUpperCase();
        return String(v);
      }
      return v.toFixed(f == null ? 2 : Math.max(0, Math.floor(f)));
    }
    return String(v);
  },
  print: function (v, f) { var s = this._str(v, f); for (var i = 0; i < s.length; i++) this._data(s.charCodeAt(i) & 255); this._flush(); return s.length; },
  println: function (v, f) { var n = this.print(v == null ? '' : v, f); this._data(13); this._data(10); this._flush(); return n + 2; },
`
}
