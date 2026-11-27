import Icon, { ICON_NAMES } from './ui/Icon.jsx'

// Library card glyph per shape type (inline SVG from the shared icon set).
const GLYPH = { box: 'cube' }
import { useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useSceneStore } from '../stores/sceneStore.js'
import { useAssetStore } from '../stores/assetStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { loadGLTFFromFile, loadSTLFromFile, cloneModel, flattenToGeometry, ensureModels, loadModel } from '../utils/modelLoader.js'
import { storeImportedGeometry } from '../managers/ObjectManager.js'
import { svgTextToGeometry } from '../utils/svgImport.js'
import { trackEvent } from '../utils/utmTracking.js'
import { PRESETS, openPreset as loadPreset } from '../utils/presets.js'
import { usePlacement, placeCardProps } from '../managers/placement.js'

const SHAPE_GROUPS = [
  {
    label: 'Basic',
    color: 'gray',
    items: [
      { type: 'box',         label: 'Cube',       icon: '⬛' },
      { type: 'sphere',      label: 'Sphere',     icon: '●'  },
      { type: 'cylinder',    label: 'Cylinder',   icon: '⬤'  },
      { type: 'cone',        label: 'Cone',       icon: '▲'  },
      { type: 'rectprism',   label: 'Long box',   icon: '▬'  },
      { type: 'plane',       label: 'Plane',      icon: '□'  },
      { type: 'torus',       label: 'Torus',      icon: '◯'  },
      { type: 'capsule',     label: 'Capsule',    icon: '💊' },
      { type: 'text',        label: 'Text',       icon: '🅣' },
    ],
  },
  {
    label: 'More shapes',
    color: 'purple',
    items: [
      { type: 'tetrahedron',  label: 'Tetrahedron', icon: '△' },
      { type: 'octahedron',   label: 'Octahedron',  icon: '◈' },
      { type: 'dodecahedron', label: 'Dodecahedron',       icon: '⬡' },
      { type: 'prism',        label: 'Triangle prism',   icon: '▷' },
      { type: 'hexagon',      label: 'Hexagon prism',   icon: '⬡' },
      { type: 'pyramid',      label: 'Pyramid',  icon: '▲' },
      { type: 'pentpyramid',  label: '5-sided pyramid',    icon: '⛛' },
    ],
  },
]

// Electronics + Mechanical part creation moved to their own dedicated right-panel
// sections (ElectronicsLibrary.jsx / MechanicalLibrary.jsx) so nothing is
// duplicated. This Library section now covers shapes, built-in models, file
// import (GLB/GLTF/STL/SVG) and saved assets.

// Built-in GLB models (preloaded in modelLoader.js). Inserted as `model` objects
// keyed by `modelKey` so they survive save/reload.
const MODELS = [
  { key: 'free_wheels', label: 'Wheels', icon: '🛞', color: '#cfd2d6' },
]


export default function AssetLibrary() {
  const addObject    = useSceneStore((s) => s.addObject)
  const insertObject = useSceneStore((s) => s.insertObject)
  const addCSGObject = useSceneStore((s) => s.addCSGObject)
  const { snapshot } = useHistory()
  const { assets, deleteAsset } = useAssetStore()

  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [dropOver, setDropOver]   = useState(false)
  const [importErr, setImportErr] = useState(null)

  const pendingKey = usePlacement((st) => st.pending?.key)

  // Insert a built-in GLB model. Clones the preloaded model into the per-id
  // registry so it renders immediately; `modelKey` lets it reload later.
  const addModel = async (key, name, color, record = true) => {
    await ensureModels([key])          // on-demand model load (deduplicated, cached)
    const objId = uuidv4()
    const model = cloneModel(key)
    if (model) storeImportedGeometry(objId, model)
    insertObject({
      id:        objId,
      name,
      type:      'model',
      modelKey:  key,
      geometryJSON: null,
      position:  { x: 0, y: 1, z: 0 },
      rotation:  { x: 0, y: 0, z: 0 },
      scale:     { x: 1, y: 1, z: 1 },
      color:     color || '#cccccc',
      material:  'standard',
      visible:   true,
      metadata:  { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    })
    if (record) snapshot()   // placement records its own undo step
    return objId
  }

  const importFiles = async (files) => {
    setImporting(true)
    setImportErr(null)
    try {
      for (const file of files) {
        const ext  = file.name.split('.').pop().toLowerCase()
        const name = file.name.replace(/\.[^.]+$/, '')
        let geometry = null

        if (['glb', 'gltf'].includes(ext)) {
          geometry = await loadGLTFFromFile(file)
        } else if (ext === 'stl') {
          geometry = await loadSTLFromFile(file)
        } else if (ext === 'svg') {
          // SVG import (relocated from the old floating toolbox): extrude the
          // drawing into a solid via the same svgTextToGeometry path.
          const svg = await file.text()
          const geo = svgTextToGeometry(svg)
          if (!geo) { setImportErr('No filled shapes found in that SVG.'); continue }
          addCSGObject(name, geo.toJSON(), '#22c55e', { x: 0, y: 1, z: 0 })
          snapshot()
          continue
        } else {
          setImportErr(`Unsupported format: .${ext}`)
          continue
        }

        if (!geometry) continue

        const objId = uuidv4()
        storeImportedGeometry(objId, geometry)   // rich model for the live session
        // Serialize so the import survives save → reload (instead of becoming a box)
        // and can be boolean-combined: STL is already one geometry; a GLB/GLTF group
        // is flattened + merged into a single geometry.
        let geometryJSON = null
        try {
          const solid = geometry.isBufferGeometry ? geometry : flattenToGeometry(geometry)
          geometryJSON = solid ? solid.toJSON() : null
        } catch (e) { console.warn('[Import] could not serialize model geometry:', e) }
        insertObject({
          id:          objId,
          name,
          type:        'model',
          geometryJSON,
          position:    { x: 0, y: 1, z: 0 },
          rotation:    { x: 0, y: 0, z: 0 },
          scale:       { x: 1, y: 1, z: 1 },
          color:       '#a8c8e8',
          material:    'standard',
          visible:     true,
          metadata:    { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        })
        snapshot()
      }
    } catch (err) {
      setImportErr(err.message)
    }
    setImporting(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDropOver(false)
    importFiles(Array.from(e.dataTransfer.files))
  }

  const handleFilePick = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) importFiles(files)
    e.target.value = ''
  }

  const [presetBusy, setPresetBusy] = useState(null)

  const openPreset = async ({ file, label }) => {
    if (useSceneStore.getState().objects.length > 0 &&
        !confirm(`Open "${label}"? It replaces what is on screen now.`)) return
    setPresetBusy(file)
    setImportErr(null)
    try {
      await loadPreset({ file, label })
      trackEvent('preset_opened', { preset: file })
    } catch (e) {
      setImportErr(`Could not load preset "${label}": ${e.message}`)
    }
    setPresetBusy(null)
  }

  const handleAddSaved = (asset) => {
    insertObject({
      ...JSON.parse(JSON.stringify(asset)),
      id:       uuidv4(),
      name:     asset.name + '_copy',
      position: { x: 0, y: 1, z: 0 },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      _savedId: undefined,
    })
    snapshot()
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-2 pb-4">
      {/* ── Shapes ───────────────────────────────────────────────────────── */}
      {SHAPE_GROUPS.map((group) => (
        <section key={group.label}>
          <div className="ui-lib-head">{group.label === 'Basic' ? 'Basic shapes' : group.label}</div>
          <div className="grid grid-cols-3 gap-0.5">
            {group.items.map(({ type, label }) => (
              <button
                key={type}
                data-tour={`shape-${type}`}
                {...placeCardProps({ key: `shape:${type}`, label: label.toLowerCase(), create: () => addObject(type) }, pendingKey)}
                title={`${label}: click, then click the grid to place it (or drag it onto the grid)`}
                className="ui-lib-card"
              >
                <span className="ui-lib-glyph"><ShapeThumb type={type} /></span>
                <span className="ui-lib-label">{label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {/* ── Starter projects (ready-made projects) ───────────────────────── */}
      <section>
        <div className="ui-lib-head">Starter projects</div>
        <div className="flex flex-col">
          {PRESETS.map((p) => (
            <button
              key={p.file}
              onClick={() => openPreset(p)}
              disabled={presetBusy !== null}
              title={`Open the ${p.label} project (replaces what is on screen)`}
              className="flex items-center justify-between h-8 px-2 rounded-md text-left text-[13px] hover:bg-gray-800 disabled:opacity-50"
              style={{ color: 'rgb(var(--g-300))' }}
            >
              {p.label}
              <span className="text-[11px]" style={{ color: 'rgb(var(--g-500))' }}>{presetBusy === p.file ? 'Opening…' : 'Open'}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Models (built-in GLB) ────────────────────────────────────────── */}
      <section>
        <div className="ui-lib-head">Models</div>
        <div className="grid grid-cols-3 gap-0.5">
          {MODELS.map(({ key, label, color }) => (
            <button
              key={key}
              {...placeCardProps({ key: `model:${key}`, label: label.toLowerCase(), prepare: () => loadModel(key), create: () => addModel(key, label, color, false) }, pendingKey)}
              onPointerEnter={() => loadModel(key)}
              title={`${label}: click, then click the grid to place it`}
              className="ui-lib-card"
            >
              <span className="ui-lib-glyph"><span className="ui-lib-tile">{label.slice(0, 2)}</span></span>
              <span className="ui-lib-label">{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── My Assets ────────────────────────────────────────────────────── */}
      <section>
        <div className="ui-lib-head">My parts</div>
        {assets.length === 0 ? (
          <div className="px-1 text-[12px] leading-relaxed" style={{ color: 'rgb(var(--g-500))' }}>
            Nothing saved yet. Select something you built, then use <b>Save as asset</b> in the Edit tab to reuse it here.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-0.5">
            {assets.map((asset) => (
              <div key={asset._savedId} className="relative group">
                <button
                  onClick={() => handleAddSaved(asset)}
                  title={`Add ${asset.name}`}
                  className="ui-lib-card w-full"
                >
                  <span className="ui-lib-glyph"><span className="w-10 h-10 rounded-md" style={{ background: asset.color }} /></span>
                  <span className="ui-lib-label truncate w-full">{asset.name}</span>
                </button>
                <button
                  onClick={() => deleteAsset(asset._savedId)}
                  title="Remove saved part"
                  aria-label="Remove saved part"
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center ui-icon-btn"
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Import ───────────────────────────────────────────────────────── */}
      <section>
        <div className="ui-lib-head">Import</div>
        <div
          className="rounded-md px-3 py-3 text-center cursor-pointer select-none transition-colors"
          style={{
            border: `1px dashed ${dropOver ? 'rgb(var(--a-600))' : 'rgb(var(--g-600))'}`,
            background: dropOver ? 'rgb(var(--a-600) / 0.06)' : 'transparent',
            color: 'rgb(var(--g-400))',
          }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDropOver(true) }}
          onDragLeave={() => setDropOver(false)}
          onDrop={handleDrop}
        >
          <div className="text-[12px] font-medium" style={{ color: 'rgb(var(--g-200))' }}>
            {importing ? 'Importing…' : 'Drop a file here, or click to choose'}
          </div>
          <div className="text-[11px] mt-0.5">GLB, GLTF, STL or SVG</div>
        </div>
        {importErr && (
          <div className="mt-1 text-[12px] px-1" style={{ color: '#dc2626' }}>{importErr}</div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,.stl,.svg"
          multiple
          className="hidden"
          onChange={handleFilePick}
        />
      </section>
    </div>
  )
}

// A shape's picture (rendered by tools/thumbs in the shape's own colour); shapes
// without one (Text) fall back to the line icon.
function ShapeThumb({ type }) {
  const [failed, setFailed] = useState(false)
  if (failed || type === 'text') return <Icon name={ICON_NAMES.includes(GLYPH[type] ?? type) ? (GLYPH[type] ?? type) : 'cube'} size={34} />
  return <img src={`${import.meta.env.BASE_URL}thumbs/shape_${type}.webp`} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
}
