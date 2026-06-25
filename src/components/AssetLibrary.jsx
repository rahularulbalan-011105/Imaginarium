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

// Electronics grouped by role. Only components the app actually supports are
// enabled; the remaining categories are shown as informative "coming soon"
// placeholders so beginners learn the taxonomy without adding broken parts.
// Hover a component to see its name + purpose.
const ELECTRONICS_CATEGORIES = [
  {
    key: 'mcu', label: 'MCUs', icon: '🧠', blurb: 'Controllers that run programs.',
    items: [
      { type: 'arduino', label: 'Arduino', icon: '🟢', desc: 'Microcontroller board', purpose: 'The programmable “brain”. Runs your code and controls everything wired to it.', usage: 'robot brains · automation · reading sensors' },
      { type: 'subo',    label: 'SUBO',    icon: '🟣', desc: 'Controller w/ I/O ports', purpose: 'A controller board with built-in I/O ports for fast prototyping.', usage: 'plug-and-play wiring · prototyping' },
    ],
  },
  {
    key: 'actuators', label: 'Actuators', icon: '⚙', blurb: 'Create movement or output.',
    items: [
      { type: 'servo',    label: 'Servo Motor', icon: '🔩', desc: 'Angle control actuator', purpose: 'Rotates to a precise angle (0–180°).', usage: 'robot arms · steering · camera gimbals' },
      { type: 'motor_dc', label: 'DC Motor',    icon: '🔧', desc: 'Continuous rotation',     purpose: 'Spins continuously at a set speed.', usage: 'wheels · fans · propellers' },
      { type: 'motor_bo', label: 'BO Motor',    icon: '⚙',  desc: 'Geared drive motor',      purpose: 'A geared DC motor — high torque at low speed.', usage: 'driving robot wheels' },
      { type: 'led',      label: 'LED',         icon: '💡', desc: 'Light output',            purpose: 'A light you can switch on/off or dim from code.', usage: 'status indicators · signals' },
    ],
  },
]

// Categories from the standard taxonomy that aren't available yet — shown so the
// structure is clear, but disabled (adding them isn't supported).
const ELECTRONICS_SOON = [
  { key: 'sensors', label: 'Sensors',       icon: '📡', note: 'Ultrasonic · IR · temperature · IMU · GPS — coming soon.' },
  { key: 'power',   label: 'Power',         icon: '🔋', note: 'Batteries · supplies · regulators — coming soon.' },
  { key: 'comms',   label: 'Communication', icon: '📶', note: 'WiFi · Bluetooth · RF — coming soon.' },
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

  // Which electronics categories are expanded (MCUs + Actuators open by default).
  const [openCats, setOpenCats] = useState({ mcu: true, actuators: true })
  const toggleCat = (key) => setOpenCats((o) => ({ ...o, [key]: !o[key] }))

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
              ? 'border-indigo-400 bg-indigo-900/20 text-indigo-700'
              : 'border-gray-600 hover:border-indigo-600/50 text-gray-400'
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
          <div className="mt-1 text-[10px] text-red-700 px-1">{importErr}</div>
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
                className="flex flex-col items-center gap-0.5 py-2 rounded bg-gray-800 hover:bg-indigo-900/30 hover:text-indigo-100 transition-colors"
              >
                <span className="text-base leading-none">{icon}</span>
                <span className="text-[8px] text-gray-500 leading-none">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* ── Electronics (categorized, expandable) ────────────────────────── */}
      <div className="px-2 pt-3">
        <div className="text-[9px] text-green-500 uppercase tracking-wider mb-1.5 font-semibold">Electronics</div>
        <div className="space-y-1">
          {ELECTRONICS_CATEGORIES.map((cat) => {
            const open = !!openCats[cat.key]
            return (
              <div key={cat.key} className="rounded-lg border border-gray-700/40 overflow-hidden bg-gray-800/40">
                <button
                  onClick={() => toggleCat(cat.key)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-gray-700/40 transition-colors"
                >
                  <span className="text-sm">{cat.icon}</span>
                  <span className="text-[12px] font-semibold" style={{ color: 'rgb(var(--g-200))' }}>{cat.label}</span>
                  <span className="text-[10px]" style={{ color: 'rgb(var(--g-500))' }}>({cat.items.length})</span>
                  <span className="ml-auto text-[10px]" style={{ color: 'rgb(var(--g-500))' }}>{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="px-1.5 pb-1.5">
                    {cat.blurb && <div className="text-[9px] mb-1 px-1" style={{ color: 'rgb(var(--g-500))' }}>{cat.blurb}</div>}
                    <div className="flex flex-col gap-1">
                      {cat.items.map(({ type, label, icon, desc, purpose, usage }) => (
                        <button
                          key={type}
                          onClick={() => addShape(type)}
                          title={`${label}\n${purpose}\nCommonly used for: ${usage}`}
                          className="group flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg bg-gray-800/70 border border-transparent hover:border-green-500/40 hover:bg-green-500/10 transition-all duration-150 text-left"
                        >
                          <span className="text-lg leading-none shrink-0">{icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-medium leading-tight truncate" style={{ color: 'rgb(var(--g-200))' }}>{label}</span>
                            <span className="block text-[10px] leading-tight truncate" style={{ color: 'rgb(var(--g-400))' }}>{desc}</span>
                          </span>
                          <span className="text-[14px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ color: '#86efac' }}>＋</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Coming-soon categories — structure is shown, parts are disabled */}
          {ELECTRONICS_SOON.map((cat) => {
            const open = !!openCats[cat.key]
            return (
              <div key={cat.key} className="rounded-lg border border-gray-800/60 overflow-hidden bg-gray-900/40">
                <button
                  onClick={() => toggleCat(cat.key)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-800/40 transition-colors"
                  title={cat.note}
                >
                  <span className="text-sm opacity-50">{cat.icon}</span>
                  <span className="text-[11px] font-medium text-gray-500">{cat.label}</span>
                  <span className="text-[9px] text-gray-600">(0)</span>
                  <span className="ml-auto text-[8px] uppercase tracking-wider text-gray-600">soon</span>
                </button>
                {open && (
                  <div className="px-2.5 pb-2 text-[9px] text-gray-600 leading-snug">{cat.note}</div>
                )}
              </div>
            )
          })}
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
        <div className="text-[9px] text-indigo-500 uppercase tracking-wider mb-1.5 font-semibold">My Assets</div>
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
                  className="w-full flex flex-col items-center gap-1 py-2 px-1 rounded transition-colors hover:bg-indigo-900/30"
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
