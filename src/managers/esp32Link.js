// ─────────────────────────────────────────────────────────────────────────────
// Hardware-link seam for a physical ESP32.
//
// HONEST SCOPE — read this before extending:
//
//  * A browser CANNOT compile C++ to an ESP32 binary. Flashing firmware needs a
//    toolchain (arduino-cli / idf.py) that does not exist in a tab. Nothing here
//    pretends otherwise; `flash()` is deliberately absent.
//  * What a browser CAN do, on Chrome/Edge over HTTPS or localhost, is talk to a
//    board that is ALREADY flashed, over Web Serial (USB CDC). That is what this
//    adapter exposes: open a port, read lines, write lines.
//  * Web Bluetooth cannot reach Bluetooth Classic SPP at all, and BLE UART needs
//    the board advertising a matching service. So Bluetooth is NOT offered here;
//    the Simulation panel's Bluetooth is explicitly labelled SIMULATED.
//  * NOT TESTED AGAINST A PHYSICAL BOARD. No ESP32 was attached while this was
//    written. The capability detection below is real; the byte-level behaviour
//    with a specific device is unverified. Treat `connect()` as a seam, not a
//    proven path, and say so to users.
//
// The adapter is intentionally dependency-free and holds no module state beyond
// the open port, so it can be swapped for a WebUSB/esptool.js implementation
// later without touching the panel.
// ─────────────────────────────────────────────────────────────────────────────

const BAUD = 115200

let port = null
let reader = null
let writer = null
let stopped = false

/** True when this browser exposes the Web Serial API in a secure context. */
export function esp32LinkAvailable() {
  return typeof navigator !== 'undefined' &&
    'serial' in navigator &&
    typeof window !== 'undefined' &&
    window.isSecureContext === true
}

/** One sentence explaining the current capability state, for the UI. */
export function esp32LinkReason() {
  if (typeof navigator === 'undefined') return 'No browser environment.'
  if (!('serial' in navigator)) {
    return 'This browser has no Web Serial API (Chrome or Edge on desktop is required; Firefox and Safari do not support it), so a physical board cannot be reached from the page.'
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Web Serial needs HTTPS or localhost. Reload over a secure origin to talk to a board.'
  }
  return 'Web Serial is available: an ESP32 that is ALREADY flashed can be opened over USB to exchange serial lines. Compiling or flashing firmware is not possible in a browser, and this path has not been verified against a physical board.'
}

export function esp32LinkConnected() {
  return port != null
}

/**
 * Ask the user for a serial port and start streaming lines.
 * Must be called from a user gesture (the browser requires it).
 * @param {{onLine:(s:string)=>void, onClose?:(e?:Error)=>void, baudRate?:number}} opts
 */
export async function esp32LinkConnect({ onLine, onClose, baudRate = BAUD } = {}) {
  if (!esp32LinkAvailable()) throw new Error(esp32LinkReason())
  if (port) return { ok: true, already: true }

  port = await navigator.serial.requestPort()   // throws if the user cancels
  await port.open({ baudRate })
  stopped = false

  const enc = new TextEncoderStream()
  enc.readable.pipeTo(port.writable).catch(() => {})
  writer = enc.writable.getWriter()

  // Read bytes → text → split on newlines, keeping the partial tail.
  ;(async () => {
    let buf = ''
    try {
      const dec = new TextDecoderStream()
      port.readable.pipeTo(dec.writable).catch(() => {})
      reader = dec.readable.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done || stopped) break
        buf += value
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '')
          buf = buf.slice(nl + 1)
          if (line) onLine?.(line)
        }
        if (buf.length > 4096) buf = buf.slice(-1024)   // runaway device, no newline
      }
      onClose?.()
    } catch (e) {
      onClose?.(e)
    }
  })()

  return { ok: true }
}

/** Write one line to the board (a newline is appended). */
export async function esp32LinkSend(text) {
  if (!writer) throw new Error('Not connected.')
  await writer.write(String(text) + '\n')
}

export async function esp32LinkDisconnect() {
  stopped = true
  try { await reader?.cancel() } catch { /* already gone */ }
  try { await writer?.close() } catch { /* already gone */ }
  try { await port?.close() } catch { /* already gone */ }
  reader = null; writer = null; port = null
}
