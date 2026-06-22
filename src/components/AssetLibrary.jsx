import { useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useSceneStore } from '../stores/sceneStore.js'
import { useAssetStore } from '../stores/assetStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { loadGLTFFromFile, loadSTLFromFile, cloneModel } from '../utils/modelLoader.js'
import { storeImportedGeometry } from '../managers/ObjectManager.js'

const SHAPE_GROUPS = [
  {
    label: 'Basic',
    color: 'gray',
    items: [
      { type: 'box',         label: 'Cube',       icon: '⬛' },
      { type: 'sphere',      label: 'Sphere',     icon: '●'  },
      { type: 'cylinder',    label: 'Cylinder',   icon: '⬤'  },
      { type: 'cone',        label: 'Cone',       icon: '▲'  },
      { type: 'rectprism',   label: 'Rect Box',   icon: '▬'  },
      { type: 'plane',       label: 'Plane',      icon: '□'  },
      { type: 'torus',       label: 'Torus',      icon: '◯'  },
      { type: 'capsule',     label: 'Capsule',    icon: '💊' },
    ],
  },
  {
    label: 'Polyhedra',
    color: 'purple',
    items: [
      { type: 'tetrahedron',  label: 'Tetrahedron', icon: '△' },
      { type: 'octahedron',   label: 'Octahedron',  icon: '◈' },
      { type: 'dodecahedron', label: 'Dodeca',       icon: '⬡' },
      { type: 'prism',        label: 'Tri Prism',   icon: '▷' },
      { type: 'hexagon',      label: 'Hex Prism',   icon: '⬡' },
      { type: 'pyramid',      label: 'Sq Pyramid',  icon: '▲' },
      { type: 'pentpyramid',  label: 'Pent Pyr',    icon: '⛛' },
    ],
  },
  {
    label: 'Mechanical',
    color: 'orange',
    items: [
      { type: 'gear',   label: 'Spur Gear', icon: '⚙' },
      { type: 'bolt',   label: 'Bolt',      icon: '🔩' },
      { type: 'screw',  label: 'Screw',     icon: '🪛' },
      { type: 'star',   label: 'Star Knot', icon: '★' },
    ],
  },
]

const ELECTRONICS = [
  { type: 'arduino',  label: 'Arduino',  icon: '🟢' },
  { type: 'subo',     label: 'SUBO',     icon: '🟣' },
  { type: 'motor_bo', label: 'Motor BO', icon: '⚙'  },
  { type: 'motor_dc', label: 'Motor DC', icon: '🔧' },
  { type: 'led',      label: 'LED',      icon: '💡' },
  { type: 'servo',    label: 'Servo',    icon: '🔩' },
  { type: 'ir_sensor',  label: 'IR Sensor',  icon: '👁' },
  { type: 'ultrasonic', label: 'Ultrasonic', icon: '📡' },
  { type: 'gas_sensor', label: 'Gas Sensor', icon: '💨' },
  { type: 'buzzer',     label: 'Buzzer',     icon: '🔔' },
  { type: 'oled',       label: 'OLED',       icon: '📺' },
]

// Built-in GLB models (preloaded in modelLoader.js). Inserted as `model` objects
// keyed by `modelKey` so they survive save/reload.
const MODELS = [
  { key: 'free_wheels', label: 'Wheels', icon: '🛞', color: '#cfd2d6' },
]

const LABEL_COLORS = {
  gray:   'text-gray-500',
  purple: 'text-purple-500',
  orange: 'text-orange-500',
}

export default function AssetLibrary() {
  const addObject    = useSceneStore((s) => s.addObject)
  const insertObject = useSceneStore((s) => s.insertObject)
  const { snapshot } = useHistory()
  const { assets, deleteAsset } = useAssetStore()

  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [dropOver, setDropOver]   = useState(false)
  const [importErr, setImportErr] = useState(null)

  const addShape = (type) => { addObject(type); snapshot() }

  // Insert a built-in GLB model. Clones the preloaded model into the per-id
  // registry so it renders immediately; `modelKey` lets it reload later.
  const addModel = (key, name, color) => {
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
    snapshot()
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
        } else {
          setImportErr(`Unsupported format: .${ext}`)
          continue
        }

        if (!geometry) continue

        const objId = uuidv4()
        storeImportedGeometry(objId, geometry)
        // Groups (GLB) can't be serialized; only STL BufferGeometry gets geometryJSON
        const geometryJSON = geometry.isBufferGeometry ? geometry.toJSON() : null
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
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── Import drop zone ─────────────────────────────────────────────── */}
      <div className="px-2 pt-3">
        <div
          className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors select-none ${
            dropOver
              ? 'border-amber-400 bg-amber-900/20 text-amber-300'
              : 'border-gray-600 hover:border-amber-600/50 text-gray-400'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDropOver(true) }}
          onDragLeave={() => setDropOver(false)}
          onDrop={handleDrop}
        >
          <div className="text-2xl mb-1">{importing ? '⏳' : '📥'}</div>
          <div className="text-[11px] font-medium">
            {importing ? 'Importing…' : 'Drop file or click to import'}
          </div>
          <div className="text-[9px] text-gray-600 mt-0.5">GLB · GLTF · STL</div>
        </div>
        {importErr && (
          <div className="mt-1 text-[10px] text-red-400 px-1">{importErr}</div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,.stl"
          multiple
          className="hidden"
          onChange={handleFilePick}
        />
      </div>

      {/* ── Shape groups ─────────────────────────────────────────────────── */}
      {SHAPE_GROUPS.map((group) => (
        <div key={group.label} className="px-2 pt-3">
          <div className={`text-[9px] uppercase tracking-wider mb-1.5 font-semibold ${LABEL_COLORS[group.color]}`}>
            {group.label}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {group.items.map(({ type, label, icon }) => (
              <button
                key={type}
                onClick={() => addShape(type)}
                title={label}
                className="flex flex-col items-center gap-0.5 py-2 rounded bg-gray-800 hover:bg-amber-900/30 hover:text-amber-100 transition-colors"
              >
                <span className="text-base leading-none">{icon}</span>
                <span className="text-[8px] text-gray-500 leading-none">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* ── Electronics ──────────────────────────────────────────────────── */}
      <div className="px-2 pt-3">
        <div className="text-[9px] text-green-600 uppercase tracking-wider mb-1.5 font-semibold">Electronics</div>
        <div className="grid grid-cols-4 gap-1">
          {ELECTRONICS.map(({ type, label, icon }) => (
            <button
              key={type}
              onClick={() => addShape(type)}
              title={label}
              className="flex flex-col items-center gap-0.5 py-2 rounded bg-gray-800 hover:bg-green-900/30 hover:text-green-100 transition-colors"
            >
              <span className="text-base leading-none">{icon}</span>
              <span className="text-[8px] text-gray-500 leading-none">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Models (built-in GLB) ────────────────────────────────────────── */}
      <div className="px-2 pt-3">
        <div className="text-[9px] text-cyan-600 uppercase tracking-wider mb-1.5 font-semibold">Models</div>
        <div className="grid grid-cols-4 gap-1">
          {MODELS.map(({ key, label, icon, color }) => (
            <button
              key={key}
              onClick={() => addModel(key, label, color)}
              title={label}
              className="flex flex-col items-center gap-0.5 py-2 rounded bg-gray-800 hover:bg-cyan-900/30 hover:text-cyan-100 transition-colors"
            >
              <span className="text-base leading-none">{icon}</span>
              <span className="text-[8px] text-gray-500 leading-none">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── My Assets ────────────────────────────────────────────────────── */}
      <div className="px-2 pt-3 pb-4">
        <div className="text-[9px] text-amber-500 uppercase tracking-wider mb-1.5 font-semibold">My Assets</div>
        {assets.length === 0 ? (
          <div className="text-[10px] text-gray-600 text-center py-4 leading-relaxed">
            No saved assets.<br />
            Select an object → Properties → Save as Asset
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {assets.map((asset) => (
              <div key={asset._savedId} className="relative group">
                <button
                  onClick={() => handleAddSaved(asset)}
                  title={`Add ${asset.name}`}
                  className="w-full flex flex-col items-center gap-1 py-2 px-1 rounded transition-colors hover:bg-amber-900/30"
                  style={{ background: `${asset.color}18` }}
                >
                  <div
                    className="w-7 h-7 rounded"
                    style={{ background: asset.color, opacity: 0.85 }}
                  />
                  <span className="text-[8px] text-gray-400 leading-none truncate w-full text-center">
                    {asset.name}
                  </span>
                </button>
                <button
                  onClick={() => deleteAsset(asset._savedId)}
                  title="Remove saved asset"
                  className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 text-[9px] text-gray-500 hover:text-red-400 leading-none px-0.5 transition-all"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
