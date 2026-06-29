import { getComponentDef } from './componentRegistry.js'

// ── Power system (Stage 6) ───────────────────────────────────────────────────
// Sums the current draw of a blueprint's components (from the Component
// Registry's electrical specs) and checks it against the declared battery
// budget. Purely advisory for now — it powers a readout in the wizard and a
// future "battery can't supply this" warning.

/** Total current draw (mA) of a blueprint's actuators + sensors + controller. */
export function computePowerDraw(blueprint) {
  if (!blueprint) return 0
  const parts = [
    ...(blueprint.actuators ?? []),
    ...(blueprint.sensors ?? []),
    ...(blueprint.controller ? [blueprint.controller] : []),
  ]
  let total = 0
  for (const p of parts) {
    total += getComponentDef(p.type)?.electrical?.currentDraw_mA ?? 0
  }
  return total
}

/** { draw_mA, budget_mA, ok } — ok=true when no budget is set or draw fits. */
export function validatePower(blueprint) {
  const draw_mA   = computePowerDraw(blueprint)
  const budget_mA = blueprint?.power?.budget_mA ?? 0
  return { draw_mA, budget_mA, ok: budget_mA <= 0 || draw_mA <= budget_mA }
}
