// ─────────────────────────────────────────────────────────────────────────────
// Program-defined simulation controls.
//
// Firmware DECLARES its controls with an annotation comment; nothing tries to
// guess UI from arbitrary C++ (that would be unreliable and would silently
// mis-read real sketches). One line per control, anywhere in the file:
//
//   // @control button  motor_fwd              label="Forward"  pin=23
//   // @control toggle  led_power  on          label="Power"    pin=2
//   // @control slider  motor_speed 0 255      step=5 value=120 label="Speed"
//   // @control number  target_rpm 0 3000      value=1200
//   // @control select  mode  idle,drive,park  value=idle
//   // @control readout distance_cm            label="Distance" unit="cm"
//
// Grammar:  @control <type> <id> [range/options] [key=value ...]
//   type    button | toggle | slider | number | select | readout
//   id      [A-Za-z_][A-Za-z0-9_]*  — unique; what the sketch reads
//   range   slider/number: <min> <max>;  select: comma-separated options
//           toggle: optional `on`/`off` initial state
//   keys    label="..."  value=...  step=...  pin=<gpio>  group="..."  unit="..."
//
// The sketch reads a control with controlValue("id") (numbers; toggles are 1/0,
// buttons are 1 while held, selects give the option INDEX) and pushes a readout
// with controlPublish("id", value).
//
// Declared pins are validated against the board table, so a control can never
// address a pin the board does not have.
// ─────────────────────────────────────────────────────────────────────────────
import { validateEsp32Pin, pinByGpio } from './esp32Board.js'

export const CONTROL_TYPES = new Set(['button', 'toggle', 'slider', 'number', 'select', 'readout'])

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
// key=value where value is "quoted" or bare
const KV_RE = /(\w+)=("([^"]*)"|'([^']*)'|[^\s]+)/g

function parseKeys(rest) {
  const keys = {}
  let m
  KV_RE.lastIndex = 0
  while ((m = KV_RE.exec(rest))) keys[m[1]] = m[3] ?? m[4] ?? m[2]
  return keys
}

/** Strip key=value pairs so only positional tokens remain. */
const positional = (rest) => rest.replace(KV_RE, ' ').trim().split(/\s+/).filter(Boolean)

/**
 * Parse `// @control …` lines out of firmware source.
 * @returns {{controls: Array, errors: Array<{line:number,message:string,hint?:string}>, warnings: Array}}
 */
export function parseControlAnnotations(src) {
  const controls = []
  const errors = []
  const warnings = []
  const seen = new Set()
  const lines = String(src ?? '').split('\n')

  lines.forEach((raw, i) => {
    const m = /^\s*(?:\/\/|\/\*)\s*@control\s+(.*?)\s*(?:\*\/)?\s*$/.exec(raw)
    if (!m) return
    const line = i + 1
    const body = m[1]
    const tokens = positional(body)
    const keys = parseKeys(body)
    const [type, id, ...rangeTokens] = tokens

    if (!type || !CONTROL_TYPES.has(type)) {
      errors.push({ line, message: `Unknown control type ${type ? `'${type}'` : ''}`.trim(), hint: `Use one of: ${[...CONTROL_TYPES].join(', ')}.` })
      return
    }
    if (!id || !ID_RE.test(id)) {
      errors.push({ line, message: `'${id ?? ''}' is not a valid control id`, hint: 'Start with a letter or _, then letters, digits or _.' })
      return
    }
    if (seen.has(id)) {
      errors.push({ line, message: `Duplicate control id '${id}'`, hint: 'Each control needs its own id.' })
      return
    }
    seen.add(id)

    const c = {
      id, type, line,
      label: keys.label ?? id.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()),
      group: keys.group ?? null,
      unit: keys.unit ?? null,
      pin: null,
      readOnly: type === 'readout',
    }

    // pin=
    if (keys.pin != null) {
      const gpio = Number(String(keys.pin).replace(/^GPIO/i, ''))
      const v = validateEsp32Pin(gpio, type === 'readout' ? 'digital' : 'output')
      if (v.level === 'error') errors.push({ line, message: `${c.id}: ${v.message}`, hint: v.hint })
      else {
        if (v.level === 'warn') warnings.push({ line, message: `${c.id}: ${v.message}`, hint: v.hint })
        c.pin = gpio
        c.pinLabel = pinByGpio(gpio)?.label ?? String(gpio)
      }
    }

    const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt }

    if (type === 'slider' || type === 'number') {
      if (rangeTokens.length < 2) {
        errors.push({ line, message: `${id}: a ${type} needs a min and a max`, hint: `e.g.  // @control ${type} ${id} 0 255` })
        return
      }
      c.min = num(rangeTokens[0], 0)
      c.max = num(rangeTokens[1], 100)
      if (!(c.max > c.min)) {
        errors.push({ line, message: `${id}: max must be greater than min`, hint: `Got min=${c.min}, max=${c.max}.` })
        return
      }
      c.step = Math.abs(num(keys.step, (c.max - c.min) <= 2 ? 0.01 : 1)) || 1
      c.value = Math.min(c.max, Math.max(c.min, num(keys.value, c.min)))
    } else if (type === 'select') {
      const opts = (rangeTokens[0] ?? '').split(',').map(s => s.trim()).filter(Boolean)
      if (opts.length < 2) {
        errors.push({ line, message: `${id}: a select needs at least two comma-separated options`, hint: `e.g.  // @control select ${id} idle,drive,park` })
        return
      }
      c.options = opts
      const want = keys.value ?? opts[0]
      c.value = Math.max(0, opts.indexOf(want))
    } else if (type === 'toggle') {
      const on = (rangeTokens[0] ?? keys.value ?? 'off').toLowerCase()
      c.value = (on === 'on' || on === '1' || on === 'true') ? 1 : 0
    } else if (type === 'button') {
      c.value = 0           // 1 only while held
    } else if (type === 'readout') {
      c.value = 0
    }
    controls.push(c)
  })

  return { controls, errors, warnings }
}

/** Default value map for a parsed control list (what the runtime starts from). */
export function controlDefaults(controls) {
  const out = {}
  for (const c of controls) out[c.id] = c.value ?? 0
  return out
}
