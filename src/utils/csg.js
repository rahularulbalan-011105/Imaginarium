import * as THREE from 'three'
import { Evaluator, Brush, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg'
import { objectManager } from '../managers/ObjectManager.js'

// Single shared evaluator. useGroups defaults to true — required for correct
// SUBTRACTION results in three-bvh-csg@0.0.18.
const evaluator = new Evaluator()

/**
 * Run a boolean operation on two scene objects.
 * Returns { geometryJSON, color } or null on failure.
 *
 * operations: 'union' | 'subtract' (A−B) | 'subtractB' (B−A) | 'intersect'
 */
export function runBoolean(idA, idB, operation) {
  const meshA = objectManager.getMesh(idA)
  const meshB = objectManager.getMesh(idB)
  if (!meshA || !meshB) return null

  try {
    // Bake the full world transform (position + rotation + scale) into cloned
    // geometries. The CSG evaluator sees two brushes both at identity transform,
    // both in world space, so the intersection is computed in world space and
    // the result geometry can be placed at (0,0,0) without any offset.
    meshA.updateMatrixWorld(true)
    const geoA = meshA.geometry.clone()
    geoA.applyMatrix4(meshA.matrixWorld)

    meshB.updateMatrixWorld(true)
    const geoB = meshB.geometry.clone()
    geoB.applyMatrix4(meshB.matrixWorld)

    // Clone materials so the original mesh materials are never touched/disposed.
    const matA = meshA.material.clone()
    const matB = meshB.material.clone()

    const brushA = new Brush(geoA, matA)
    brushA.updateMatrixWorld(true)

    const brushB = new Brush(geoB, matB)
    brushB.updateMatrixWorld(true)

    let source, cutter, op, resultColor
    if (operation === 'subtractB') {
      source = brushB; cutter = brushA; op = SUBTRACTION
      resultColor = '#' + meshB.material.color.getHexString()
    } else if (operation === 'union') {
      source = brushA; cutter = brushB; op = ADDITION
      resultColor = '#' + meshA.material.color.getHexString()
    } else if (operation === 'subtract') {
      source = brushA; cutter = brushB; op = SUBTRACTION
      resultColor = '#' + meshA.material.color.getHexString()
    } else if (operation === 'intersect') {
      source = brushA; cutter = brushB; op = INTERSECTION
      resultColor = '#' + meshA.material.color.getHexString()
    } else {
      return null
    }

    const result = evaluator.evaluate(source, cutter, op)
    result.geometry.computeBoundingBox()

    // Center the geometry at its bounding-box midpoint and record that center as the
    // mesh's world position.  Without this the CSG mesh sits at (0,0,0) with
    // world-space vertex coordinates, so the transform gizmo appears at the scene
    // origin instead of at the combined shape.
    const center = new THREE.Vector3()
    result.geometry.boundingBox.getCenter(center)
    result.geometry.translate(-center.x, -center.y, -center.z)

    const geometryJSON = result.geometry.toJSON()

    // Dispose only what we created — never touch the original mesh materials.
    result.geometry.dispose()
    if (Array.isArray(result.material)) result.material.forEach(m => m?.dispose?.())
    else result.material?.dispose?.()
    geoA.dispose()
    geoB.dispose()
    matA.dispose()
    matB.dispose()

    return {
      geometryJSON,
      color:    resultColor,
      position: { x: center.x, y: center.y, z: center.z },
    }
  } catch (err) {
    console.error('[CSG] Boolean operation failed:', err?.message ?? err)
    return null
  }
}
