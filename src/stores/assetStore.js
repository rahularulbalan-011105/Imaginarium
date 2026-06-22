import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

const STORAGE_KEY = '3d_editor_saved_assets'

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
}

function persist(assets) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(assets)) }
  catch (e) { console.warn('AssetStore: localStorage full', e) }
}

export const useAssetStore = create((set, get) => ({
  assets: load(),

  saveAsset: (obj) => {
    const asset = { ...JSON.parse(JSON.stringify(obj)), _savedId: uuidv4() }
    const updated = [...get().assets, asset]
    persist(updated)
    set({ assets: updated })
  },

  deleteAsset: (savedId) => {
    const updated = get().assets.filter(a => a._savedId !== savedId)
    persist(updated)
    set({ assets: updated })
  },
}))
