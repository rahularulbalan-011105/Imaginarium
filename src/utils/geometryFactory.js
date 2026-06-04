import * as THREE from 'three'

export function createGeometry(type) {
  switch (type) {
    case 'box':       return new THREE.BoxGeometry(2, 2, 2)
    case 'sphere':    return new THREE.SphereGeometry(1, 32, 32)
    case 'cylinder':  return new THREE.CylinderGeometry(1, 1, 2, 32)
    case 'cone':      return new THREE.ConeGeometry(1, 2, 32)
    case 'torus':     return new THREE.TorusGeometry(1, 0.4, 16, 100)
    case 'plane':     return new THREE.PlaneGeometry(3, 3)
    case 'capsule':   return new THREE.CapsuleGeometry(0.6, 1.2, 4, 16)
    case 'pyramid':   return new THREE.ConeGeometry(1.2, 2, 4)
    case 'prism':     return new THREE.CylinderGeometry(1, 1, 2, 3)
    case 'diamond':   return new THREE.OctahedronGeometry(1.2, 0)
    case 'hexagon':   return new THREE.CylinderGeometry(1, 1, 2, 6)
    case 'star':      return new THREE.TorusKnotGeometry(0.7, 0.25, 64, 8, 2, 3)
    default:          return new THREE.BoxGeometry(2, 2, 2)
  }
}

export function createMaterial(color = '#3b82f6', materialType = 'standard') {
  switch (materialType) {
    case 'metallic':
      return new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.2 })
    case 'transparent':
      return new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45, roughness: 0.3 })
    default:
      return new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.65 })
  }
}
