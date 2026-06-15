import { useRef, useState, useCallback } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { storageManager } from '../managers/StorageManager.js'
import { historyManager } from '../managers/HistoryManager.js'
import { downloadJSON, readJSONFile } from '../utils/export.js'
import { buildProjectSnapshot } from '../utils/helpers.js'
import { v4 as uuidv4 } from 'uuid'

export default function Header() {
  const projectName    = useSceneStore((s) => s.projectName)
  const setProjectName = useSceneStore((s) => s.setProjectName)
  const projectId      = useSceneStore((s) => s.projectId)
  const setProjectId   = useSceneStore((s) => s.setProjectId)
  const objects        = useSceneStore((s) => s.objects)
  const gridVisible    = useSceneStore((s) => s.gridVisible)
  const axesVisible    = useSceneStore((s) => s.axesVisible)
  const setObjects     = useSceneStore((s) => s.setObjects)
  const clearScene     = useSceneStore((s) => s.clearScene)

  const clearAttachments = useElectronicsStore((s) => s.clearAttachments)
  const setConnections   = useElectronicsStore((s) => s.setConnections)
  const setAttachments   = useElectronicsStore((s) => s.setAttachments)
  const setCode          = useElectronicsStore((s) => s.setCode)

  const [saving, setSaving]           = useState(false)
  const [saveFlash, setSaveFlash]     = useState(false)
  const [showMenu, setShowMenu]       = useState(false)
  const [showOpenDlg, setShowOpenDlg] = useState(false)
  const [savedProjects, setSavedProjects] = useState([])
  const importRef = useRef(null)

  // ── snapshot helper ───────────────────────────────────────────────────────
  const getSnapshot = useCallback(() =>
    buildProjectSnapshot(useSceneStore.getState(), useElectronicsStore.getState()),
  [])

  // ── apply loaded / imported data to all stores ────────────────────────────
  const applyProjectData = useCallback((data) => {
    setProjectName(data.name || 'Untitled Project')
    setProjectId(data.projectId || uuidv4())
    setObjects(data.objects || [])
    clearAttachments()
    if (data.electronics) {
      if (data.electronics.connections !== undefined) setConnections(data.electronics.connections)
      if (data.electronics.code       !== undefined) setCode(data.electronics.code)
      if (data.electronics.attachments !== undefined) setAttachments(data.electronics.attachments)
    }
    historyManager.clear()
  }, [setProjectName, setProjectId, setObjects, clearAttachments, setConnections, setCode, setAttachments])

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    try {
      await storageManager.saveProject(getSnapshot())
      setSaveFlash(true)
      setTimeout(() => setSaveFlash(false), 1200)
    } finally {
      setSaving(false)
    }
  }

  // ── new project ───────────────────────────────────────────────────────────
  const handleNewProject = () => {
    if (objects.length > 0 && !confirm('Start a new project? Unsaved changes will be lost.')) return
    clearScene()
    clearAttachments()
    setProjectId(uuidv4())
    setProjectName('Untitled Project')
    historyManager.clear()
    setShowMenu(false)
  }

  // ── open saved projects dialog ────────────────────────────────────────────
  const handleOpenDialog = async () => {
    setShowMenu(false)
    const projects = await storageManager.getAllProjects()
    setSavedProjects(projects.sort((a, b) => new Date(b.modified) - new Date(a.modified)))
    setShowOpenDlg(true)
  }

  const handleLoadProject = async (id) => {
    const data = await storageManager.loadProject(id)
    if (!data) return
    applyProjectData(data)
    setShowOpenDlg(false)
  }

  const handleDeleteSaved = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this saved project? This cannot be undone.')) return
    await storageManager.deleteProject(id)
    setSavedProjects((p) => p.filter((proj) => proj.projectId !== id))
  }

  // ── export / import ───────────────────────────────────────────────────────
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
      applyProjectData(data)
    } catch {
      alert('Failed to import project. Make sure it is a valid JSON file.')
    }
    e.target.value = ''
  }

  return (
    <>
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

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
            saveFlash
              ? 'bg-green-600 text-white'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {saving ? 'Saving…' : saveFlash ? '✓ Saved' : '💾 Save'}
        </button>

        {/* File menu */}
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
              <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded shadow-xl z-20 py-1">
                <MenuItem onClick={handleNewProject}  icon="📄" label="New Project" />
                <MenuItem onClick={handleOpenDialog}  icon="📂" label="Open Saved…" />
                <div className="border-t border-gray-700 my-1" />
                <MenuItem onClick={handleExportJSON}  icon="⬇" label="Export JSON" />
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

      {/* ── Open Saved Projects dialog ─────────────────────────────────────── */}
      {showOpenDlg && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowOpenDlg(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md pointer-events-auto">

              {/* Dialog header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-700">
                <h2 className="text-sm font-semibold text-white">Open Saved Project</h2>
                <button
                  onClick={() => setShowOpenDlg(false)}
                  className="text-gray-500 hover:text-white text-lg leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Project list */}
              <div className="max-h-96 overflow-y-auto">
                {savedProjects.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-gray-500">
                    <span className="text-3xl">📭</span>
                    <span className="text-sm">No saved projects yet</span>
                    <span className="text-xs text-gray-600">Click 💾 Save to store your work</span>
                  </div>
                ) : (
                  savedProjects.map((proj) => (
                    <div
                      key={proj.projectId}
                      onClick={() => handleLoadProject(proj.projectId)}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-800 cursor-pointer border-b border-gray-700/40 last:border-0 group transition-colors"
                    >
                      <span className="text-2xl shrink-0">📁</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate group-hover:text-blue-300 transition-colors">
                          {proj.name || 'Untitled Project'}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {new Date(proj.modified).toLocaleString()} · {proj.objects?.length ?? 0} object{proj.objects?.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSaved(proj.projectId, e)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-red-900/20 transition-all"
                        title="Delete project"
                      >
                        🗑
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Dialog footer */}
              {savedProjects.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-700 text-xs text-gray-500">
                  {savedProjects.length} saved project{savedProjects.length !== 1 ? 's' : ''} · click a project to open it
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
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
