import { useRef, useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { storageManager } from '../managers/StorageManager.js'
import { historyManager } from '../managers/HistoryManager.js'
import { downloadJSON, readJSONFile } from '../utils/export.js'
import { buildProjectSnapshot } from '../utils/helpers.js'
import { v4 as uuidv4 } from 'uuid'

export default function Header() {
  const projectName = useSceneStore((s) => s.projectName)
  const setProjectName = useSceneStore((s) => s.setProjectName)
  const projectId = useSceneStore((s) => s.projectId)
  const setProjectId = useSceneStore((s) => s.setProjectId)
  const objects = useSceneStore((s) => s.objects)
  const gridVisible = useSceneStore((s) => s.gridVisible)
  const axesVisible = useSceneStore((s) => s.axesVisible)
  const setObjects = useSceneStore((s) => s.setObjects)
  const clearScene = useSceneStore((s) => s.clearScene)
  const clearAttachments = useElectronicsStore((s) => s.clearAttachments)
  const [saving, setSaving] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const importRef = useRef(null)

  const getSnapshot = () =>
    buildProjectSnapshot(useSceneStore.getState())

  const handleSave = async () => {
    setSaving(true)
    try {
      await storageManager.saveProject(getSnapshot())
    } finally {
      setSaving(false)
    }
  }

  const handleNewProject = () => {
    if (objects.length > 0 && !confirm('Start a new project? Unsaved changes will be lost.')) return
    clearScene()
    clearAttachments()
    setProjectId(uuidv4())
    setProjectName('Untitled Project')
    historyManager.clear()
    setShowMenu(false)
  }

  const handleExportJSON = () => {
    downloadJSON(getSnapshot(), `${projectName}.json`)
    setShowMenu(false)
  }

  const handleImportClick = () => {
    importRef.current?.click()
    setShowMenu(false)
  }

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = await readJSONFile(file)
      setProjectName(data.name || 'Imported Project')
      setProjectId(data.projectId || uuidv4())
      setObjects(data.objects || [])
      clearAttachments()
      historyManager.clear()
    } catch {
      alert('Failed to import project. Make sure it is a valid JSON file.')
    }
    e.target.value = ''
  }

  return (
    <header className="flex items-center gap-3 px-4 h-12 bg-gray-900 border-b border-gray-700/50 shrink-0 z-10">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <span className="text-lg">🧊</span>
        <span className="text-sm font-semibold text-white hidden sm:block">3D Editor</span>
      </div>

      {/* Project name */}
      <input
        type="text"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        className="bg-transparent border-b border-gray-600/50 text-sm text-white px-1 py-0.5 focus:outline-none focus:border-blue-500 w-40 min-w-0"
      />

      <div className="flex-1" />

      {/* Action buttons */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
      >
        {saving ? 'Saving…' : '💾 Save'}
      </button>

      {/* Menu */}
      <div className="relative">
        <button
          onClick={() => setShowMenu((v) => !v)}
          className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
        >
          ☰ File
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 top-full mt-1 w-44 bg-gray-800 border border-gray-700 rounded shadow-xl z-20 py-1">
              <MenuItem onClick={handleNewProject} icon="📄" label="New Project" />
              <div className="border-t border-gray-700 my-1" />
              <MenuItem onClick={handleExportJSON} icon="⬇" label="Export JSON" />
              <MenuItem onClick={handleImportClick} icon="⬆" label="Import JSON" />
            </div>
          </>
        )}
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />
    </header>
  )
}

function MenuItem({ onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
