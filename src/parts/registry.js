// ─────────────────────────────────────────────────────────────────────────────
// Part registry. The catalogue (every src/parts/catalog/**/*.part.js, gathered
// by catalog/index.js) is ONE lazy chunk: loadParts() fetches it during boot
// (main.jsx) so its models and simulation code stay out of the startup bundle.
//
// Code that needs catalogue data at module level subscribes with
// onPartsRegistered(fn): fn runs for every part already registered and for
// every part registered later. Code that runs on user action (adding a part,
// starting the simulation) just calls getPart()/allParts().
// ─────────────────────────────────────────────────────────────────────────────
import { PIN_KINDS, pinsOf, internalOf, defaultProps } from './definePart.js'

const PARTS = new Map()
const subscribers = new Set()
let loading = null
let loaded = false

/** Register parts (the catalogue chunk, or a test). Duplicate types are a bug. */
export function registerParts(list) {
  for (const part of list) {
    if (!part?.type) throw new Error('[parts] registerParts: entry without a type')
    if (PARTS.has(part.type)) throw new Error(`[parts] duplicate part type "${part.type}"`)
    PARTS.set(part.type, part)
    for (const fn of subscribers) { try { fn(part) } catch (e) { console.error('[parts] subscriber failed for', part.type, e) } }
  }
}

/** Run fn(part) for every part now and in future. Returns an unsubscribe. */
export function onPartsRegistered(fn) {
  for (const p of PARTS.values()) fn(p)
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

/** Fetch + register the catalogue once. Resolves with every part. */
export function loadParts() {
  loading ??= import('./catalog/index.js').then((m) => {
    registerParts(m.default.filter(p => !PARTS.has(p.type)))
    loaded = true
    return allParts()
  })
  return loading
}
export const partsLoaded = () => loaded

export const getPart = (type) => PARTS.get(type) ?? null
export const isPartType = (type) => PARTS.has(type)
export const allParts = () => [...PARTS.values()]
export const partTypes = () => [...PARTS.keys()]
export const partsInCategory = (key) => allParts().filter(p => p.category === key)

/** Pin names in wiring order (WiringPanel / Workbench / utils/wiring PIN_DEFS). */
export function partPinNames(type, obj) {
  const p = getPart(type)
  return p ? pinsOf(p, obj).map(x => x.name) : null
}

/** 3D pin-sphere table in the electronicsFactory PIN_DEFS shape. */
export function partPinDefs3D(type, obj) {
  const p = getPart(type)
  if (!p) return null
  return Object.fromEntries(pinsOf(p, obj).map(pin => {
    const k = PIN_KINDS[pin.kind]
    return [pin.name, { x: pin.x, y: pin.y, z: pin.z, r: pin.r ?? 0.09, color: k.color, type: k.type,
      label: pin.label ?? pin.name, ldy: pin.ldy ?? 0, ldx: pin.ldx ?? 0, noLabel: !!pin.noLabel }]
  }))
}

export function partInternal(type, obj) {
  const p = getPart(type)
  return p ? internalOf(p, obj) : []
}

/** Fields a new scene object of this type starts with. */
export function partDefaults(type) {
  const p = getPart(type)
  return p ? defaultProps(p) : {}
}

/** Pin kind lookup ('gnd' | 'power' | …) for a part pin. */
export function partPinKind(type, pinName, obj) {
  const p = getPart(type)
  return p ? pinsOf(p, obj).find(x => x.name === pinName)?.kind ?? null : null
}
