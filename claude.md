# 3D Design Editor (Tinkercad Clone) — Project Documentation

## Project Overview

A web-based 3D object design and manipulation tool inspired by Tinkercad. Users can create, edit, and manage 3D objects in a browser-based editor without any login or authentication. Projects are stored locally in the browser using IndexedDB.

The editor has expanded well beyond a basic 3D modeller into a full robotics design, simulation, and gaming platform. It supports: parametric solid editing (extrude, fillet/chamfer, boolean CSG, geometry bending), mechanical joints, electronics wiring with both **text (Arduino C++)** and **visual (Blockly)** programming, wheeled and legged robot simulation with physics, a **Robo-Sumo "Battle" game mode** (local + online P2P), an asset library with external 3D model import, the custom **SUBO ESP32 board**, and Google Drive integration.

**Status:** MVP shipped — Phase 2 features largely implemented; active work on a command-pattern undo/redo rebuild
**Target Users:** Hobbyists, educators, makers, 3D printing enthusiasts, robotics learners
**Platform:** Web (Browser-based, responsive desktop), built with Vite

---

## Technology Stack

### Frontend Architecture

```
React 18+ + Three.js + Zustand + Tailwind CSS + Vite
```

### Core Dependencies

| Package | Purpose |
|---------|---------|
| **React 18** | Component-based UI framework |
| **Three.js** | 3D rendering engine |
| **Zustand** | Lightweight state management |
| **Tailwind CSS** | Styling |
| **three-bvh-csg** | Boolean CSG operations (union, subtract, intersect) |
| **three-mesh-bvh** | BVH acceleration (raycasting, CSG) |
| **@dimforge/rapier3d-compat** | WASM rigid-body physics engine |
| **three-stdlib** | OrbitControls, TransformControls, GLTFLoader, etc. |
| **blockly** | Visual block-based programming editor (Arduino code authoring) |
| **peerjs** | WebRTC P2P networking (online Battle mode) |
| **uuid** | Unique ID generation |
| **Vite** | Dev server and bundler |
| **playwright** (dev) | Browser automation / testing |
| **gh-pages** (dev) | GitHub Pages deploy |

> **Install note:** new dependencies may need `npm install --legacy-peer-deps` (three-bvh-csg has a peer-dep conflict).

---

## Actual Project Structure

```
src/
├── App.jsx                         # Root — render loop, keyboard shortcuts, bond propagation, right-sidebar tabs
├── main.jsx
├── components/
│   ├── Viewport.jsx                # Three.js canvas, raycasting, gizmo wiring, attachment sync
│   ├── Toolbar.jsx                 # Shape/electronics creation toolbar
│   ├── PropertiesPanel.jsx         # Selected-object editor (transform, color, bend, visibility)
│   ├── DimensionEditorPanel.jsx    # Live W/H/D editor — center vs one-sided (locked-face) scaling
│   ├── ObjectList.jsx              # Scene hierarchy list, multi-select, visibility toggles
│   ├── Header.jsx                  # File controls, project management, Drive sync
│   ├── BooleanPanel.jsx            # CSG boolean UI (union/subtract/intersect)
│   ├── ExtrudePanel.jsx            # Face extrude workflow (merge / keep / cancel)
│   ├── FilletPanel.jsx             # Fillet / chamfer edges (radius, segments, edge-angle)
│   ├── JointPanel.jsx              # Mechanical joint creation + drive/motor controls
│   ├── WiringPanel.jsx             # Pin-to-pin wire connection editor (state machine)
│   ├── CodeEditor.jsx              # Arduino C++ code editor panel
│   ├── BlocksPanel.jsx             # Blockly visual programming editor (lazy-loaded)
│   ├── BattlePanel.jsx             # Robo-Sumo lobby (Local/Online) + in-match HUD
│   ├── AssetLibrary.jsx            # Shapes/electronics/models insert + import + saved assets
│   ├── DrivePanel.jsx              # Simulation controls (wheeled + legged robot)
│   ├── ElectronicsPanel.jsx        # Wire connections editor (legacy)
│   ├── DimensionOverlay.jsx        # On-canvas size labels for selected objects
│   ├── ViewGizmo.jsx               # Camera view cube (Top/Front/Right/… + Home)
│   ├── SurfaceAttachPrompt.jsx     # Prompt to bond two selected surface patches
│   ├── PanelErrorBoundary.jsx      # Wraps panels so one crash doesn't take down the editor
│   └── StatusBar.jsx               # Bottom status bar
├── stores/
│   ├── sceneStore.js               # Objects, selection, CSG objects, scene settings
│   ├── uiStore.js                  # Panel/tab state, sim active flag, extrude state
│   ├── electronicsStore.js         # Components, connections, servo attachments, Arduino code, SUBO pin maps
│   ├── physicsStore.js             # Environment, gravity, wind, legged robot state
│   ├── rigidStore.js               # Rigid-body joint definitions / surface bonds (relativeMatrix)
│   ├── surfaceStore.js             # Surface-patch selection + bond relationships
│   ├── jointStore.js               # Mechanical joint definitions (types, axis, limits, motor)
│   ├── gearStore.js                # Gear mesh pairings (meshPairs)
│   ├── assetStore.js               # User-saved object templates (localStorage)
│   ├── gameStore.js                # Battle-mode state, HUD, online lobby fields
│   └── historyStore.js             # Reactive mirror of undo/redo stacks (for a debug panel)
├── managers/
│   ├── SceneManager.js             # Three.js scene, renderer, camera, lighting, grid, named views
│   ├── ObjectManager.js            # Add/remove/update meshes; animateServo, animateLed, setBend, reattachLocal
│   ├── DriveManager.js             # Enters/exits simulation; routes to wheeled or legged path
│   ├── SimulationManager.js        # Runs Arduino/Subo code via arduinoParser transpiler
│   ├── WireManager.js              # Renders wire connections in 3D
│   ├── ExtrudeTool.js              # Face selection + side-wall generation for extrude
│   ├── FilletTool.js               # Vertex-displacement fillet / chamfer / bevel
│   ├── JointManager.js             # Renders joint helpers; solves joint constraints each frame
│   ├── BattleManager.js            # Robo-Sumo arena, top-down arcade physics, netcode, proxy rendering
│   ├── NetworkManager.js           # PeerJS WebRTC wrapper (STUN + TURN) for online Battle
│   ├── StorageManager.js           # IndexedDB persistence
│   ├── PatchManager.js             # Incremental scene patches
│   ├── history/
│   │   ├── Command.js              # Command, CompositeCommand, SnapshotCommand
│   │   ├── HistoryManager.js       # Command stack, nestable transactions, 1000 cap
│   │   └── editorDispatch.js       # Single dispatch facade (execute/transaction/undo/redo/snapshot bridge)
│   ├── physics/
│   │   ├── PhysicsManager.js       # Rapier WASM world, rigid bodies, joints
│   │   ├── PhysicsIntegrator.js    # Kinematic fallback integrator (inertia, drag, friction, wind)
│   │   ├── MassCalculator.js       # Volume-based mass, moment of inertia, frontal area
│   │   └── EnvironmentConfig.js    # Environment presets (Earth, Moon, Mars, Zero-G)
│   └── robot/
│       ├── LeggedSystem.js         # Auto-detect + drive hexapod/quadruped/biped robots
│       ├── GaitEngine.js           # Tripod / trot / alternating gait phases
│       ├── IKSolver.js             # Inverse kinematics for leg foot targets
│       └── DifferentialDrive.js    # Wheeled differential drive math
├── blockly/
│   ├── arduinoBlocks.js            # Custom Arduino blocks + toolbox definition
│   └── arduinoGenerator.js         # Blockly → Arduino C++ code generator
├── hooks/
│   ├── useHistory.js               # Delegates to editorDispatch (legacy snapshot() bridge)
│   ├── useScene.js
│   └── useSelection.js
├── utils/
│   ├── geometryFactory.js          # Primitive geometry creators + applyBendDeform
│   ├── csg.js                      # runBoolean() — CSG with gizmo-correct positioning
│   ├── arduinoParser.js            # Full Arduino C++ lexer + parser + JS transpiler
│   ├── electronicsFactory.js       # Create electronics component meshes + pin spheres
│   ├── robotAssembly.js            # Union-find grouping of bonds + attachments into robots
│   ├── modelLoader.js              # GLTF/GLB/STL external model import
│   ├── export.js                   # JSON/STL/GLTF export
│   └── helpers.js                  # Utilities + buildProjectSnapshot (save/load)
└── styles/
    └── globals.css
```

> `public/models/` ships: `arduino_uno.glb`, `subo.glb`, `servo.glb`, `motor_dc.glb`, `motor_bo.glb`, `led.glb`, `free_wheels.glb`.

---

## Right-Sidebar Tabs (App.jsx `TABS`)

`Props` · `Objects` · `⚡ Wiring` · `⚙ Joints` · `🧩 Blocks` · `{ } Code` · `⚔ Battle` · `📦 Library`.
The `⊕ Boolean` tab is injected only while two boolean-capable objects are selected (auto-focused, reverts to `Props` when the pair is broken).

---

## Implemented Features

### 3D Viewport & Scene
- [x] Three.js WebGL renderer with orbit camera (OrbitControls)
- [x] TransformControls gizmo — move / rotate / scale modes (`W`/`E`/`R`)
- [x] Raycasting object selection (click in viewport)
- [x] Grid background (toggleable `G`) and coordinate axes (toggleable `A`)
- [x] Ambient + directional lighting with shadows
- [x] Object selection highlight (emissive outline)
- [x] Dimension overlay — shows width/height/depth in scene units on selected object
- [x] **ViewGizmo** — camera view cube: Top/Front/Right/Back/Left/Bottom + Home (isometric)
- [x] Snap-to-grid

### Shape Creation
- [x] Primitives: Cube, Sphere, Cylinder, Cone, Torus, Plane (plus polyhedra / mechanical groups in AssetLibrary)
- [x] External 3D model import (GLTF/GLB/STL) via `modelLoader.js` (drag-drop in AssetLibrary)
- [x] Electronics components: Arduino Uno, **SUBO board**, DC/BO motors, servo, LED, sensors
- [x] **Asset library** — saved-object templates persisted to localStorage (`assetStore`)
- [x] Keyboard shortcuts `1`–`5` to add primitives

### Object Manipulation
- [x] Real-time transform via Properties Panel (position, rotation, per-axis & uniform scale)
- [x] **Dimension Editor** — type exact W/H/D; center scaling or one-sided (locked-face) scaling
- [x] Color picker (hex + swatch); Material types: Standard, Metallic, Transparent
- [x] Rename inline · Duplicate (`Ctrl+D`) · Delete · Show/hide
- [x] **Geometry bending** — cylindrical bend deform (axis X/Y/Z, angle −180°→+180°, idempotent, resettable)

### Solid Editing / CAD Tools
- [x] **Boolean CSG**: Union, Subtract A−B, Subtract B−A, Intersect — with gizmo-correct centering (see Architecture)
- [x] **Extrude** (`ExtrudeTool`): pick a face (normal match), generate side walls, then Merge (CSG union) / Keep both / Cancel
- [x] **Fillet / Chamfer** (`FilletTool`): vertex-displacement bevel on sharp edges; radius, segment count, edge-angle threshold; result becomes a CSG object (electronics/gears excluded)
- [x] **Mechanical Joints** (`JointManager` + `jointStore`): fixed, hinge, revolute, slider, ball, servo; per-joint axis, limits, manual drive sliders, and motor (speed/torque/target); Fusion-style feature picker (`createFeatureJoint`) infers type from corner/edge/face selection
- [x] **Surface bonding** (`surfaceStore` + `SurfaceAttachPrompt`): select two surface patches → connect; bond stored in `rigidStore` (`relativeMatrix`), propagated every frame
- [x] **Gear pairing** (`gearStore.meshPairs`)

### Scene Management
- [x] Object list panel, multi-select (Shift+click), visibility toggles
- [x] Undo/redo (`Ctrl+Z` / `Ctrl+Y`) — see **Undo/Redo (command-pattern rebuild)** below
- [x] Auto-save to IndexedDB (every 30 s); save / load / delete projects
- [x] Export JSON / STL / GLTF; export via File System Access API picker (download fallback)
- [x] Import project JSON (restores exact attachments via `reattachLocal`)

### Electronics System
- [x] Arduino, **SUBO**, servo, DC/BO motor, brushless motor, LED, sensor components
- [x] **WiringPanel** — pin-to-pin connection editor (state machine: pick source pin → dest pin → color/confirm); fan-out from GND/5V; 3D wire tubes via WireManager
- [x] **CodeEditor** — Arduino C++ panel
- [x] **BlocksPanel** — Blockly visual programming (lazy-loaded ~700 KB); blocks transpile to Arduino C++ via `arduinoGenerator`; workspace persisted as `blocksJson`
- [x] **Arduino code simulation** via full C++ lexer+parser+transpiler (`arduinoParser.js`): variables, functions, control flow, structs; Arduino API (`pinMode`, `digitalWrite`, `analogWrite/Read`, `delay`, `Serial.*`, `Servo.write`, `millis()`, …)
- [x] **SUBO library API** injected into the simulator (matrix/buzzer/motor helpers); board-agnostic simulator maps `D<n>`/`IO<n>` → GPIO
- [x] Servo attachment — attach 3D arms to servos; arms animate on `Servo.write()`
- [x] LED animation; bond propagation so bonded objects follow animated arms each frame

### Physics Simulation
- [x] **Rapier WASM** rigid-body physics (`PhysicsManager.js`)
- [x] **Kinematic fallback integrator** (`PhysicsIntegrator.js`) — inertia lag, air drag, rolling friction, wind force
- [x] **MassCalculator** — volume × material density mass; moment of inertia; frontal area for drag
- [x] **Environment presets** (`EnvironmentConfig.js`): Earth, Moon, Mars, Zero-G
- [x] Wind (direction + speed + turbulence). Scale: 1 scene unit = 0.05 m (5 cm)

### Wheeled Robot Simulation
- [x] Auto-detect differential-drive robots (≥2 motors wired to Arduino)
- [x] `analogWrite(pin, speed)` → motor speed → `DifferentialDrive` → linear/angular velocity
- [x] Body moves with physics (friction, drag, gravity); DrivePanel run/stop + serial log

### Legged Robot Simulation
- [x] Auto-detect hexapod / quadruped / biped from servo+arm pairs
- [x] **GaitEngine**: tripod (6), trot (4), alternating (2–3); foot targets → servo angles
- [x] DrivePanel legged mode: D-pad + arrow keys (only active when `isLeggedRobot`); leg-count & gait badges
- [x] Gait skipped while Arduino code is running so `Servo.write()` overrides

### Robo-Sumo "Battle" Game Mode
- [x] Push opponent out of a ring or drain HP by ramming; 100 HP, 3 lives, best-of-3
- [x] **Local 2-player** (P1=WASD, P2=arrows) and **online 2-player** via WebRTC P2P
- [x] **Online = PeerJS** (`NetworkManager`) with STUN + free TURN relays; 5-char room codes (invite-by-code, not matchmaking)
- [x] **Split-authority netcode**: each client simulates its own robot, broadcasts state; opponent rendered as a box-cluster proxy, then upgraded to full real geometry streamed **one mesh per message** with backpressure pacing (`_sendPaced`) + completeness retries
- [x] **Arcade top-down physics** (discs on ring plane: accel/friction/momentum/restitution + circle-circle collision), NOT Rapier; tuning constants at top of `BattleManager.js`
- [x] Robots detected as **assemblies** via `robotAssembly.js` (union of surface-bonds + motor attachments)
- [x] Rigid whole-assembly movement; live nose/front change without exiting; loading screen until opponent geometry fully arrives

### Google Drive Integration
- [x] Drive panel in Header for cloud save/load; `DriveManager.js` handles OAuth + Drive API calls

---

## Data Models

### Scene Object (sceneStore)

```javascript
{
  id: "uuid",
  name: "Cube_1",
  type: "box",           // box | sphere | cylinder | cone | torus | plane | csg | model | <electronics-type>
  position: { x, y, z },
  rotation: { x, y, z },
  scale:    { x, y, z },
  color: "#ff6b6b",
  material: "standard",  // standard | metallic | transparent
  visible: true,
  deform: {              // optional — only when bent
    bend: 45,            // degrees, -180..180
    bendAxis: "y"        // x | y | z
  },
  attach: {              // optional — exact local transform inside a motor rotor (save/load)
    motorId, position, quaternion, scale
  },
  metadata: { createdAt, updatedAt }
}
```

### CSG Object (sceneStore.addCSGObject)

```javascript
addCSGObject(name, geometryJSON, color, position)
// position = bounding-box center of the boolean result (gizmo anchor)
```

### Joint (jointStore)

```javascript
{
  id, type,              // fixed | hinge | revolute | slider | ball | servo
  parentId, childId,
  anchor: { x, y, z },
  axis:   { x, y, z },
  limits: { minAngle, maxAngle, minDist, maxDist },
  motor:  { speed, torque, targetAngle },
  ballRot: { x, y, z }
}
```

### Physics Store

```javascript
{
  environment: 'earth',       // earth | moon | mars | zero_g
  gravity: -9.80665,
  airDensity: 1.225,
  groundFriction: 0.7,
  rollingFriction: 0.015,
  wind: { x, z, speed, turbulence },
  groundType: 'concrete',
  isLeggedRobot: false,
  leggedControl: { speed: 0, turn: 0 },
  leggedGaitType: 'auto',
}
```

---

## Key Architecture Decisions

### Undo/Redo (command-pattern rebuild — in progress)
The old full-snapshot stack (`HistoryManager.js` + `CommandManager.js`, both deleted) is being replaced by a **command-pattern** system under [src/managers/history/](src/managers/history/):
- `Command.js` — `Command`, `CompositeCommand`, `SnapshotCommand`
- `HistoryManager.js` — command stack, nestable transactions (begin/commit/rollback), 1000-entry cap, mirrors into `historyStore` for a future debug panel
- `editorDispatch.js` — **single dispatch facade**: `execute`, `transaction`, `recordSnapshot` (legacy bridge), `undo`/`redo`, `captureCanonical`/`restoreCanonical`, `resetBaseline`/`clear`
- [useHistory.js](src/hooks/useHistory.js) now just delegates to `editorDispatch`, so the ~47 existing `snapshot()` call sites keep working — each records a before→after `SnapshotCommand`.
- **Canonical snapshot** = the same 5 slices as before (objects, attachments, bonds, patches, joints), deliberately unchanged so behavior is identical except bugs fixed. Viewport gizmo drag now records **one** canonical `recordSnapshot('transform')` after the bond-matrix update (fixes the old "undo after a drag wiped the whole scene" bug and the one-undo-per-drag issue). App init → `resetBaseline()`; Header load/new → `clear()`.
- **Roadmap:** migrate each domain to fine-grained commands (Transform→Object→Boolean→Joints→Wiring→Properties→Physics); make wire lines + imported geometry store-derived so undo restores visuals; enforce the facade as the only mutation path; build `HistoryDebugPanel`. Save/load stays fully separate on the `'1.0'` format — never write history into project files.

### CSG Gizmo Positioning
After `evaluator.evaluate()` (three-bvh-csg), vertex coordinates are in world space (transforms baked in). The mesh must be placed at the shape's visual center or the gizmo appears at the scene origin. Fix in `csg.js`:
```js
result.geometry.computeBoundingBox()
const center = new THREE.Vector3()
result.geometry.boundingBox.getCenter(center)
result.geometry.translate(-center.x, -center.y, -center.z)
return { geometryJSON, color: resultColor, position: { x: center.x, y: center.y, z: center.z } }
```
`BooleanPanel` (and FilletPanel/ExtrudePanel) pass `result.position` to `addCSGObject`.

### Geometry Bending (`applyBendDeform`)
Cylindrical bend math: `R = H / θ`. Saves original positions in `geometry.userData.origPos` (idempotent). Axis permutation: Y-bend (h=y,a=z,b=x); Z-bend (h=z,a=x,b=y); X-bend (h=x,a=y,b=z). Skipped for CSG objects.

### Legged vs Wheeled Detection (`DriveManager.enter()`)
1. Count motors wired to Arduino → if `≥2` → wheeled path.
2. Else check for servo objects with children in `attachments`.
3. If `LeggedSystem.build()` finds ≥2 servo+arm leg pairs → legged path; `setIsLeggedRobot(true)`.

### Robot Assembly Grouping (`robotAssembly.js`)
Union-find over surface bonds (rigidStore) + motor attachments (electronicsStore) partitions the scene into connected components, each with a `rootId` (prefers a non-child bond parent). Used by Battle (whole-robot dropdown) and simulation to move parts as one unit. Bond propagation is **skipped during battle** so `BattleManager` owns positions.

### Arduino Transpiler & Board-Agnostic Simulator
Recursive-descent parser in `arduinoParser.js` (lexer → typed tokens → parser → JS codegen, run in a sandboxed eval with Arduino API shims). The simulator maps any pin named `D<n>`/`IO<n>` → GPIO, so the **SUBO board** reuses it unchanged (SUBO constants + library functions are prepended to the script). Blockly programs are converted to the same C++ via `arduinoGenerator` before running.

### Registering a New Controller Board (e.g. SUBO)
Files that key off `'arduino'` and need the new type: `modelLoader` (MODEL_PATHS + MODEL_SCALE_TARGET), `electronicsFactory` (PIN_DEFS + create*Group + addPinSpheres), `ObjectManager` (ELECTRONICS set + createMesh dispatch), `sceneStore` (isElectronics + default pos), `Toolbar`/`AssetLibrary` (buttons), `WiringPanel` (ELEC_TYPES + PIN_DEFS + COMP_ICONS), `CodeEditor` (hasArduino), `App` (ELEC_TYPES), `Viewport`/`PropertiesPanel`/`BooleanPanel`/`FilletPanel` (isElectronics lists), `MassCalculator`.

### Online Battle Geometry Streaming
The opponent must look exactly like the original. `getRobotGeo` sends every real leaf mesh (incl. GLB motor internals) as records (positions+index+normals+per-leaf material+relative matrix); reparented children attributed via `ownerOf`/`memberOf`. Sends are **backpressure-paced** (`_sendPaced` waits for `dataChannel.bufferedAmount` < 64 KB) — a synchronous burst overflows the WebRTC SCTP buffer and drops messages. Receiver tracks arrived indices and requests a re-stream (`georeq`) if it stalls. Orientation is preserved via `geometa` (root rest quaternion + front angle + baseY, captured at REST before placement).

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `W` / `E` / `R` | Gizmo Translate / Rotate / Scale (Scale blocked for electronics) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+D` | Duplicate selected |
| `Delete` | Delete selected |
| `G` / `A` | Toggle grid / axes |
| `F` | Frame/fit selection |
| `1`–`5` | Add cube/sphere/cylinder/cone/torus |
| `Escape` | Deselect all |
| `↑↓←→` | Control legged robot (only during legged simulation) |
| `WASD` / `↑↓←→` | Battle mode: P1 / P2 drive (editor shortcuts blocked while a battle is active) |
| Mouse Wheel | Zoom · Middle Drag | Orbit · Right Drag | Pan |

---

## Setup & Running

```bash
npm install            # add --legacy-peer-deps if peer-dep conflicts appear
npm run dev            # Vite dev server
npm run build          # Production build
npm run deploy         # Build + publish dist/ to gh-pages
```

**Note:** Rapier WASM (`@dimforge/rapier3d-compat`) loads asynchronously on startup; physics requires it to initialize before `DriveManager.enter()`.

---

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome | Full (recommended) |
| Firefox | Full |
| Safari | Full (macOS 10.11+) |
| Edge | Full |

Requires: WebGL 2.0, ES2020+, IndexedDB, SharedArrayBuffer (Rapier WASM — needs COOP/COEP headers in production). Online Battle additionally needs WebRTC (and may rely on TURN relays on restrictive networks).

---

## Deployment

```bash
npm run build
# Deploy dist/ folder as a static site (npm run deploy publishes to gh-pages)
```

GitHub Pages config is in `vite.config.js` (base path). COOP/COEP headers must be set for Rapier WASM SharedArrayBuffer support.

---

## Development Roadmap

### Completed
- [x] Core 3D viewport, orbit camera, gizmo, named camera views (ViewGizmo)
- [x] All primitive shapes + external model import (GLTF/GLB/STL)
- [x] Properties panel + Dimension editor (center / one-sided scaling)
- [x] Object list, local storage, project save/load/export
- [x] Boolean CSG, Extrude, Fillet/Chamfer, geometry bending
- [x] Mechanical joints (fixed/hinge/revolute/slider/ball/servo) + feature picker
- [x] Surface bonding, gear pairing
- [x] Electronics: wiring panel, Arduino C++ editor, **Blockly visual programming**, simulation
- [x] **SUBO ESP32 board** (board-agnostic simulator + library API)
- [x] Physics (Rapier + kinematic fallback), multiple environments
- [x] Wheeled + legged robot simulation
- [x] **Robo-Sumo Battle mode** (local + online P2P)
- [x] Asset library (saved templates) + Google Drive integration

### In Progress
- [ ] Command-pattern undo/redo — Stages 1+2 landed; Stages 3–7 (fine-grained commands, visual reconciliation, facade enforcement, debug panel, perf) pending

### Remaining / Future
- [ ] Boolean operations on CSG results (nested booleans)
- [ ] Object grouping / hierarchy
- [ ] Texture & normal map support
- [ ] Advanced lighting (point lights, spotlights, HDRI)
- [ ] Online Battle matchmaking / lobby server (currently invite-by-code only)
- [ ] Mobile responsiveness
- [ ] SUBO: 3D LED-matrix lighting, buzzer audio, A/B buttons as `digitalRead` inputs

---

## Troubleshooting

**Undo after a gizmo drag wipes the scene**
→ Fixed: the drag now records one canonical `recordSnapshot('transform')` (5-slice) instead of pushing a bare objects array. See history rebuild above.

**Gizmo appears at wrong location after Boolean/Fillet/Extrude**
→ `csg.js` centers geometry at the bounding-box origin and returns `position` for mesh placement; the panel passes it to `addCSGObject`.

**Arrow keys conflict with transform shortcuts (W/E/R)**
→ Arrow listeners attach only when `isLeggedRobot === true` (legged sim) or a battle is active.

**Servo arms / attached wheels don't animate or fly apart on reimport**
→ Arm must be in `attachments` (electronicsStore) with the servo's ID. `propagateAllBonds()` runs every frame. On load, `reattachLocal(objectId, motorId, obj.attach)` restores the exact local transform (retries up to 20× while the GLB loads).

**Online Battle opponent is invisible or upside-down**
→ Geometry must be streamed per-mesh with backpressure pacing (not one big message, not a sync burst); orientation needs `geometa` (rest quaternion) re-applied. See Online Battle Geometry Streaming.

**Rapier physics not working**
→ Rapier WASM must finish loading before simulation; ensure COOP/COEP headers (SharedArrayBuffer) in production.

**A panel crashed and took focus**
→ Panels are wrapped in `PanelErrorBoundary`; use its Retry button. The rest of the editor stays alive.

**Canvas not rendering**
→ Check WebGL 2.0 support; verify canvas dimensions > 0.

---

**Last Updated:** 2026-06-22
**Version:** 1.3.0 (Post-MVP — CAD tools + Joints + Blockly + SUBO board + Robo-Sumo Battle; command-pattern undo/redo in progress)
