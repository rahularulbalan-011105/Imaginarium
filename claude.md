# 3D Design Editor (Tinkercad Clone) — Project Documentation

## Project Overview

A web-based 3D object design and manipulation tool inspired by Tinkercad. Users can create, edit, and manage 3D objects in a browser-based editor without any login or authentication. Projects are stored locally in the browser using IndexedDB.

The editor has expanded well beyond a basic 3D modeller into a full robotics simulation platform: it supports electronics wiring (Arduino-like code execution), wheeled and legged robot simulation with physics, boolean CSG operations, geometry bending, Google Drive integration, and external 3D model import.

**Status:** MVP shipped — Phase 2 features largely implemented  
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
| **@dimforge/rapier3d-compat** | WASM rigid-body physics engine |
| **three-stdlib** | OrbitControls, TransformControls, GLTFLoader, etc. |
| **uuid** | Unique ID generation |
| **Vite** | Dev server and bundler |

---

## Actual Project Structure

```
src/
├── App.jsx                         # Root — render loop, keyboard shortcuts, bond propagation
├── main.jsx
├── components/
│   ├── Viewport.jsx                # Three.js canvas, raycasting, gizmo wiring
│   ├── Toolbar.jsx                 # Shape/electronics creation toolbar
│   ├── PropertiesPanel.jsx         # Selected-object editor (transform, color, bend, visibility)
│   ├── ObjectList.jsx              # Scene hierarchy list, multi-select, visibility toggles
│   ├── Header.jsx                  # File controls, project management, Drive sync
│   ├── BooleanPanel.jsx            # CSG boolean UI (union/subtract/intersect)
│   ├── CodeEditor.jsx              # Monaco-style Arduino code editor panel
│   ├── DrivePanel.jsx              # Simulation controls (wheeled + legged robot)
│   ├── ElectronicsPanel.jsx        # Wire connections editor
│   ├── DimensionOverlay.jsx        # On-canvas size labels for selected objects
│   └── StatusBar.jsx               # Bottom status bar
├── stores/
│   ├── sceneStore.js               # Objects, selection, CSG objects, scene settings
│   ├── uiStore.js                  # Panel state, sim active flag
│   ├── electronicsStore.js         # Components, connections, servo attachments, Arduino code
│   ├── physicsStore.js             # Environment, gravity, wind, legged robot state
│   ├── rigidStore.js               # Rigid-body joint definitions
│   └── surfaceStore.js             # Surface-bond relationships
├── managers/
│   ├── SceneManager.js             # Three.js scene, renderer, camera, lighting, grid
│   ├── ObjectManager.js            # Add/remove/update meshes; animateServo, animateLed, setBend
│   ├── DriveManager.js             # Enters/exits simulation; routes to wheeled or legged path
│   ├── SimulationManager.js        # Runs Arduino code via arduinoParser transpiler
│   ├── WireManager.js              # Renders wire connections in 3D
│   ├── HistoryManager.js           # Undo/redo (50-action stack)
│   ├── StorageManager.js           # IndexedDB persistence
│   ├── PatchManager.js             # Incremental scene patches
│   ├── physics/
│   │   ├── PhysicsManager.js       # Rapier WASM world, rigid bodies, joints
│   │   ├── PhysicsIntegrator.js    # Kinematic fallback integrator (inertia, drag, friction, wind)
│   │   ├── MassCalculator.js       # Volume-based mass, moment of inertia, frontal area
│   │   └── EnvironmentConfig.js    # Environment presets (Earth, Moon, Mars, Zero-G)
│   └── robot/
│       ├── LeggedSystem.js         # Auto-detect + drive hexapod/quadruped robots
│       ├── GaitEngine.js           # Tripod / trot / alternating gait phases
│       ├── IKSolver.js             # Inverse kinematics for leg foot targets
│       └── DifferentialDrive.js    # Wheeled differential drive math
├── hooks/
│   ├── useHistory.js
│   ├── useScene.js
│   └── useSelection.js
├── utils/
│   ├── geometryFactory.js          # Primitive geometry creators + applyBendDeform
│   ├── csg.js                      # runBoolean() — CSG with gizmo-correct positioning
│   ├── arduinoParser.js            # Full Arduino C++ lexer + parser + JS transpiler
│   ├── electronicsFactory.js       # Create electronics component meshes
│   ├── modelLoader.js              # GLTF/GLB external model import
│   ├── export.js                   # JSON/STL/GLTF export
│   └── helpers.js                  # Utility functions
└── styles/
    └── globals.css
```

---

## Implemented Features

### 3D Viewport & Scene
- [x] Three.js WebGL renderer with orbit camera (OrbitControls)
- [x] TransformControls gizmo — move / rotate / scale modes (`W`/`E`/`R`)
- [x] Raycasting object selection (click in viewport)
- [x] Grid background (toggleable `G`)
- [x] Coordinate axes (toggleable `A`)
- [x] Ambient + directional lighting with shadows
- [x] Object selection highlight (emissive outline)
- [x] Dimension overlay — shows width/height/depth in scene units on selected object
- [x] Snap-to-grid

### Shape Creation
- [x] Primitives: Cube, Sphere, Cylinder, Cone, Torus, Plane
- [x] External 3D model import (GLTF/GLB) via `modelLoader.js`
- [x] Servo motor model (`servo_motor_sg_90.glb`) loaded from `/public/models/servo.glb`
- [x] Keyboard shortcuts `1`–`5` to add primitives

### Object Manipulation
- [x] Real-time transform (position, rotation, scale) via Properties Panel
- [x] Per-axis scale control
- [x] Uniform scale toggle
- [x] Color picker (hex + swatch)
- [x] Material types: Standard, Metallic, Transparent
- [x] Rename objects inline
- [x] Duplicate (`Ctrl+D`)
- [x] Delete (`Delete` key or button)
- [x] Show/hide per object
- [x] **Geometry bending** — cylindrical bend deform on any primitive:
  - Axis selector (X/Y/Z), angle slider −180°→+180°
  - Idempotent: re-applies cleanly; original vertices saved in `geometry.userData.origPos`
  - Reset button to unbend

### Scene Management
- [x] Object list panel with visibility toggles
- [x] Multi-select (Shift+click in object list)
- [x] Undo/redo (`Ctrl+Z` / `Ctrl+Y`), 50-action limit
- [x] Auto-save to IndexedDB (every 30 s)
- [x] Save / load / delete projects
- [x] Export JSON / STL / GLTF
- [x] Import project JSON

### Boolean CSG Operations ✅
- [x] Union (A + B → merged shape)
- [x] Subtract A−B (cut B out of A)
- [x] Subtract B−A
- [x] Intersect (keep overlap only)
- [x] **Gizmo fix**: result geometry is centered at bounding-box midpoint; mesh placed at world-space center → transform arrows appear correctly on the combined shape
- Uses `three-bvh-csg` — world transforms baked into geometry before evaluation

### Electronics System
- [x] Arduino, servo, DC motor, brushless motor, LED, sensor components
- [x] Visual wire connections between components (WireManager renders 3D tubes)
- [x] ElectronicsPanel — add/remove/edit connections
- [x] CodeEditor — Monaco-style panel for writing Arduino C++ code
- [x] **Arduino code simulation** via full C++ lexer+parser+transpiler (`arduinoParser.js`):
  - Supports: variables, functions, if/else, for/while/do, switch/case, structs
  - Arduino API: `setup()`, `loop()`, `pinMode`, `digitalWrite`, `analogWrite`, `analogRead`, `delay`, `Serial.print`, `Servo.write`, `millis()`, etc.
- [x] Servo attachment — attach 3D arm objects to servo components; arms animate on `Servo.write()`
- [x] LED animation — brightness updates during code execution
- [x] Bond propagation — surface-bonded objects follow animated servo arms every frame

### Physics Simulation
- [x] **Rapier WASM** rigid-body physics (`PhysicsManager.js`)
- [x] **Kinematic fallback integrator** (`PhysicsIntegrator.js`) — inertia lag, air drag, rolling friction, wind force
- [x] **MassCalculator** — volume × material density for accurate mass; moment of inertia; frontal area for drag
- [x] **Environment presets** (`EnvironmentConfig.js`):
  - Earth (9.81 m/s², ρ=1.225 kg/m³), Moon (1.62 m/s²), Mars (3.72 m/s²), Zero-G
- [x] Wind: direction vector + speed + turbulence
- [x] Scale constant: 1 scene unit = 0.05 m (5 cm)

### Wheeled Robot Simulation
- [x] Auto-detect differential-drive robots (≥2 motor components wired to Arduino)
- [x] `analogWrite(pin, speed)` → motor speed → `DifferentialDrive` → linear/angular velocity
- [x] Robot body moves in scene; physics applied (friction, drag, gravity)
- [x] DrivePanel: Run/Stop code buttons, serial log output, quick reference

### Legged Robot Simulation ✅
- [x] **Auto-detect** hexapod (6 legs), quadruped (4 legs), or biped (2 legs) from servo+arm attachment pairs
- [x] **GaitEngine**: tripod gait (6 legs), trot (4 legs), alternating (2–3 legs)
- [x] Foot targets in body-local space (+Z forward) → servo angles via `animateServo()`
  - `angle = 90 + norm * 30°` swing + up to +25° lift during swing phase
- [x] Body moves via PhysicsIntegrator (inertia, drag, friction) or Rapier body
- [x] DrivePanel legged mode:
  - D-pad buttons (mouse/touch)
  - Arrow key controls (↑↓←→) — registered only when `isLeggedRobot=true` to avoid W/E/R transform conflicts
  - Leg count badge, gait type badge
- [x] Skip-gait when Arduino code is running (`simulationManager.isRunning()`) so `Servo.write()` overrides
- [x] `physicsStore`: `isLeggedRobot`, `leggedControl: { speed, turn }`, `leggedGaitType`

### Google Drive Integration
- [x] Drive panel in Header for cloud save/load
- [x] `DriveManager.js` handles OAuth + Drive API calls

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
  metadata: { createdAt, updatedAt }
}
```

### CSG Object (sceneStore.addCSGObject)

```javascript
addCSGObject(name, geometryJSON, color, position)
// position = bounding-box center of the boolean result (gizmo anchor)
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

### CSG Gizmo Positioning
After `evaluator.evaluate()` (three-bvh-csg), vertex coordinates are in world space (transforms were baked in). The mesh must be placed at the shape's visual center or the TransformControls gizmo appears at scene origin. Fix in `csg.js`:
```js
result.geometry.computeBoundingBox()
const center = new THREE.Vector3()
result.geometry.boundingBox.getCenter(center)
result.geometry.translate(-center.x, -center.y, -center.z)
return { geometryJSON, color: resultColor, position: { x: center.x, y: center.y, z: center.z } }
```
`BooleanPanel` passes `result.position` to `addCSGObject`.

### Geometry Bending (`applyBendDeform`)
Cylindrical bend math: `R = H / θ` where H = object height along bend axis, θ = angle in radians.
- Saves original positions in `geometry.userData.origPos` on first call (idempotent)
- Axis permutation: Y-bend uses (h=y, a=z, b=x); Z-bend uses (h=z, a=x, b=y); X-bend uses (h=x, a=y, b=z)
- Skipped for CSG objects (no buffer geometry access pattern)

### Legged vs Wheeled Detection
`DriveManager.enter()`:
1. Count motor objects connected to Arduino → if `motors.length >= 2` → wheeled path
2. Else → check for servo objects that have children in `attachments` map
3. If `LeggedSystem.build()` returns true (≥2 servo+arm leg pairs detected) → legged path
4. `setIsLeggedRobot(true)` in physicsStore; DrivePanel switches UI

### Arduino Transpiler
Full recursive-descent parser in `arduinoParser.js` (not regex-based):
- Lexer produces typed tokens: NUM, STR, IDENT, KW, OP, PUNCT, PP
- Parser handles structs, typedefs, pointer-ish syntax, preprocessor directives (stripped)
- Code generator emits JS that runs in a sandboxed eval context with Arduino API shims

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `W` | Switch gizmo to Translate mode |
| `E` | Switch gizmo to Rotate mode |
| `R` | Switch gizmo to Scale mode |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+D` | Duplicate selected |
| `Delete` | Delete selected |
| `G` | Toggle grid |
| `A` | Toggle axes |
| `F` | Frame/fit selection |
| `1`–`5` | Add cube/sphere/cylinder/cone/torus |
| `Escape` | Deselect all |
| `↑↓←→` | Control legged robot (only active during legged simulation) |
| Mouse Wheel | Zoom camera |
| Middle Drag | Rotate camera (orbit) |
| Right Drag | Pan camera |

---

## Setup & Running

```bash
npm install
npm run dev      # Vite dev server
npm run build    # Production build
```

**Note:** Rapier WASM (`@dimforge/rapier3d-compat`) loads asynchronously on startup. Physics simulation requires it to initialize before DriveManager.enter() is called.

---

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome | Full (recommended) |
| Firefox | Full |
| Safari | Full (macOS 10.11+) |
| Edge | Full |

Requires: WebGL 2.0, ES2020+, IndexedDB, SharedArrayBuffer (for Rapier WASM — needs COOP/COEP headers in production).

---

## Deployment

```bash
npm run build
# Deploy dist/ folder as a static site
```

GitHub Pages config is in `vite.config.js` (base path set for gh-pages). COOP/COEP headers must be set for Rapier WASM SharedArrayBuffer support.

---

## Development Roadmap

### Completed (as of 2026-06-11)
- [x] Core 3D viewport, orbit camera, gizmo
- [x] All primitive shapes + external model import (GLTF)
- [x] Properties panel (transform, color, material, bend, visibility)
- [x] Object list, undo/redo, local storage
- [x] Electronics system (Arduino code, servos, motors, LEDs, wires)
- [x] Boolean CSG (union, subtract, intersect) with correct gizmo positioning
- [x] Geometry bending (cylindrical deform)
- [x] Physics simulation (Rapier + kinematic fallback), multiple environments
- [x] Wheeled robot simulation (differential drive)
- [x] Legged robot simulation (auto-gait: tripod/trot/alternating)
- [x] Google Drive integration

### Remaining / Future
- [ ] STL export for 3D printing
- [ ] Boolean operations on CSG results (nested booleans)
- [ ] Object grouping / hierarchy
- [ ] Texture & normal map support
- [ ] Advanced lighting (point lights, spotlights, HDRI)
- [ ] Collaborative editing (WebSocket)
- [ ] Mobile responsiveness

---

## Troubleshooting

**Gizmo appears at wrong location after Boolean operation**
→ Fixed: `csg.js` centers geometry at bounding-box origin and returns `position` for mesh placement.

**Arrow keys conflict with transform shortcuts (W/E/R)**
→ Arrow key listeners only attach when `isLeggedRobot === true` (DrivePanel useEffect).

**Servo arms don't animate**
→ Check that the arm object is listed in `attachments` (electronicsStore) with the servo's ID as its value. `propagateAllBonds()` runs every frame in App.jsx to propagate position to bonded children.

**Rapier physics not working**
→ Rapier WASM must finish loading before simulation starts. Check browser console for WASM init errors; also ensure COOP/COEP headers are set if deploying (required for SharedArrayBuffer).

**Canvas not rendering**
→ Check WebGL 2.0 support; verify canvas element dimensions > 0.

---

**Last Updated:** 2026-06-11  
**Version:** 1.2.0 (Post-MVP — Electronics + Physics + Legged Robots + CSG)
