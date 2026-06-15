import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export const useGearStore = create((set) => ({
  meshPairs: [],  // [{ id, gearAId, gearBId }]

  addMeshPair: (gearAId, gearBId) =>
    set(s => ({
      meshPairs: [...s.meshPairs, { id: uuidv4(), gearAId, gearBId }],
    })),

  removeMeshPair: (pairId) =>
    set(s => ({ meshPairs: s.meshPairs.filter(p => p.id !== pairId) })),

  removePairsForGear: (gearId) =>
    set(s => ({
      meshPairs: s.meshPairs.filter(p => p.gearAId !== gearId && p.gearBId !== gearId),
    })),
}))
