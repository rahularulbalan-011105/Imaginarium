// Ready-made Constructa starter projects (full project files in public/presets/,
// fetched on demand). Opening one loads it as the current project through the
// same `constructa:load-project` path a saved project uses. Pictures live in
// public/thumbs/preset_<file>.webp (tools/thumbs/render-preset-thumbs.cjs).
import { v4 as uuidv4 } from 'uuid'

export const PRESETS = [
  { file: '2-wheel-chassis', label: '2-wheel robot car', blurb: 'Two motors and wheels on a base. The easiest robot to drive.' },
  { file: '4-wheel-chassis', label: '4-wheel robot car', blurb: 'Four-wheel drive on a bigger base.' },
  { file: 'simple-claw',     label: 'Robot claw',        blurb: 'A servo-driven gripper that opens and closes.' },
  { file: 'single-leg',      label: 'Robot leg',         blurb: 'One jointed leg, the start of a walking robot.' },
  { file: 'robotic-head',    label: 'Robot head',        blurb: 'A head that turns on a servo.' },
  { file: 'propeller',       label: 'Propeller',         blurb: 'A motor spinning a propeller.' },
  { file: 'name-plate',      label: 'Name plate',        blurb: 'A 3D-printable sign with your name.' },
]

export const presetThumb = (file) => `${import.meta.env.BASE_URL}thumbs/preset_${file}.webp`

/** Fetch a starter project and load it as the current project. */
export async function openPreset({ file, label }) {
  const res = await fetch(`${import.meta.env.BASE_URL}presets/${file}.json`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  // Fresh id so saving never overwrites another copy of the same preset.
  window.dispatchEvent(new CustomEvent('constructa:load-project', {
    detail: { ...data, projectId: uuidv4(), name: label },
  }))
}
