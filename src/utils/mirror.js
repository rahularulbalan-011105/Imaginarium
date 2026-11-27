// Mirror (Tinkercad's Flip) across a world axis: the position is reflected and
// the scale on that axis negated, which is a true reflection (handedness flips),
// not a 180° rotation. Used by the Properties → Pattern / Mirror tool.
export function mirrorPatch(obj, axis) {
  if (!['x', 'y', 'z'].includes(axis)) return null
  const position = { ...obj.position, [axis]: -obj.position[axis] }
  const scale = { ...obj.scale, [axis]: -obj.scale[axis] }
  return { position, scale }
}
