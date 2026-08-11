const DB_NAME = '3d-editor'
const DB_VERSION = 1
const STORE = 'projects'

class StorageManager {
  constructor() {
    this.db = null
    this._timer = null
  }

  async _open() {
    if (this.db) return this.db
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'projectId' })
        }
      }
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db) }
      req.onerror = (e) => reject(e.target.error)
    })
  }

  async saveProject(data) {
    const db = await this._open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ ...data, modified: new Date().toISOString() })
      // Remember the last-saved fingerprint so autosave can skip no-op writes,
      // whether the save came from autosave OR the manual Save button.
      tx.oncomplete = () => { this._lastSaved = this._serialize(data); resolve(data.projectId) }
      tx.onerror = (e) => reject(e.target.error)
    })
  }

  // Stable fingerprint of a project (created/modified change every snapshot, so
  // they're excluded — otherwise every autosave would look "changed").
  _serialize(data) {
    try { return JSON.stringify({ ...data, created: undefined, modified: undefined }) } catch { return null }
  }

  // Broadcast autosave status so the header indicator can reflect it.
  _emitStatus(state) {
    try { window.dispatchEvent(new CustomEvent('constructa:autosave', { detail: { state, at: Date.now() } })) } catch { /* SSR/no-window */ }
  }

  async loadProject(id) {
    const db = await this._open()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id)
      req.onsuccess = (e) => resolve(e.target.result)
      req.onerror = (e) => reject(e.target.error)
    })
  }

  async deleteProject(id) {
    const db = await this._open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = (e) => reject(e.target.error)
    })
  }

  async getAllProjects() {
    const db = await this._open()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll()
      req.onsuccess = (e) => resolve(e.target.result || [])
      req.onerror = (e) => reject(e.target.error)
    })
  }

  enableAutoSave(getProjectData, intervalMs = 30000) {
    this.disableAutoSave()
    this._timer = setInterval(async () => {
      const data = getProjectData()
      if (!data) return
      // Dirty-check: skip the write entirely when nothing changed since last save.
      const serial = this._serialize(data)
      if (serial && serial === this._lastSaved) return
      this._emitStatus('saving')
      try { await this.saveProject(data); this._emitStatus('saved') }
      catch (e) { console.error(e); this._emitStatus('error') }
    }, intervalMs)
  }

  disableAutoSave() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  }
}

export const storageManager = new StorageManager()
