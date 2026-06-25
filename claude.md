# 3D Design Editor (Tinkercad Clone) — Project Documentation

## Project Overview

A web-based 3D object design and manipulation tool inspired by Tinkercad. Users can create, edit, and manage 3D objects in a browser-based editor without any login or authentication. Projects are stored locally in the browser using IndexedDB.

The editor has expanded well beyond a basic 3D modeller into a full robotics simulation platform: it supports electronics wiring (Arduino-like code execution), wheeled and legged robot simulation with physics, boolean CSG operations, geometry bending, Google Drive integration, and external 3D model import.

**Status:** Post-MVP — full robotics platform + light theme & interactive onboarding  
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
| **blockly** | Visual drag-and-drop Arduino programming (Blocks panel) |
| **peerjs** | WebRTC peer connections for online robo-sumo battles |
| **uuid** | Unique ID generation |
| **Vite** | Dev server and bundler |
| **playwright** (dev) | Headless screenshots for UI/theme verification |

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
│   ├── BlocksPanel.jsx             # Blockly visual coding workspace → Arduino C++
│   ├── DrivePanel.jsx              # Simulation controls (wheeled + legged robot)
│   ├── ElectronicsPanel.jsx        # Wire connections editor
│   ├── WiringPanel.jsx             # Pin-level wiring UI (per-component pin maps)
│   ├── JointPanel.jsx              # Mechanical joint editor (hinge/revolute/slider/ball/servo)
│   ├── FilletPanel.jsx             # Chamfer/fillet edges of a selected mesh
│   ├── ExtrudePanel.jsx            # Face-extrude tool UI
│   ├── DimensionEditorPanel.jsx    # Typed W/H/D bounding-box resize (center / one-sided)
│   ├── AssetLibrary.jsx            # Shape + saved-asset palette (grouped)
│   ├── BattlePanel.jsx             # Robo-sumo HUD (HP/lives bars, local + online setup)
│   ├── ViewGizmo.jsx               # Standard-view cube (top/front/right/…) + home button
│   ├── SurfaceAttachPrompt.jsx     # Surface-patch selection / bonding prompt
│   ├── WelcomeOverlay.jsx          # First-run entry card (Teach me / Tour / Explore)
│   ├── PanelErrorBoundary.jsx      # Wraps panels so a crash can't kill the editor
│   ├── DimensionOverlay.jsx        # On-canvas size labels for selected objects
│   ├── StatusBar.jsx               # Bottom status bar
│   └── onboarding/                 # Guided coach, product tour, help menu, modals, hints
├── stores/
│   ├── sceneStore.js               # Objects, selection, CSG objects, scene settings
│   ├── uiStore.js                  # Panel state, sim active flag, extrude/fillet tool state
│   ├── electronicsStore.js         # Components, connections, servo attachments, Arduino code
│   ├── physicsStore.js             # Environment, gravity, wind, legged robot state
│   ├── rigidStore.js               # Rigid-body / surface-bond definitions
│   ├── surfaceStore.js             # Surface-patch relationships
│   ├── jointStore.js               # Mechanical joints (type, axis, limits, motor settings)
│   ├── assetStore.js               # User-saved assets (localStorage-backed)
│   ├── gameStore.js                # Robo-sumo battle state + remappable controls
│   └── historyStore.js             # Reactive mirror of undo/redo stacks (debug panel)
├── managers/
│   ├── SceneManager.js             # Three.js scene, renderer, camera, lighting, grid
│   ├── ObjectManager.js            # Add/remove/update meshes; animateServo, animateLed, setBend
│   ├── DriveManager.js             # Enters/exits simulation; routes to wheeled or legged path
│   ├── SimulationManager.js        # Runs Arduino code via arduinoParser transpiler
│   ├── WireManager.js              # Renders wire connections in 3D
│   ├── JointManager.js             # Joint markers + constraint solving / child driving
│   ├── ExtrudeTool.js              # Face extrusion on BufferGeometry
│   ├── FilletTool.js               # Vertex-chamfer / bevel on sharp edges
│   ├── BattleManager.js            # Robo-sumo simulation (ring physics, HP, hits)
│   ├── NetworkManager.js           # WebRTC P2P transport (PeerJS) for online battles
│   ├── StorageManager.js           # IndexedDB persistence
│   ├── PatchManager.js             # Incremental scene patches
│   ├── history/
│   │   ├── HistoryManager.js       # Command-stack undo/redo (transactions, MAX 1000)
│   │   ├── Command.js              # Command / CompositeCommand / SnapshotCommand primitives
│   │   └── editorDispatch.js       # Single sanctioned facade for recording undoable edits
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
├── blockly/
│   ├── arduinoBlocks.js            # Custom Arduino hardware blocks + toolbox
│   └── arduinoGenerator.js         # Blockly → Arduino C++ code generator
├── onboarding/
│   ├── onboardingStore.js          # UI-only onboarding state (localStorage)
│   ├── coachSteps.js               # Guided-coach step data (27 steps)
│   ├── tourSteps.js                # Passive product-tour data
│   └── missions.js                 # Legacy mission checklist (superseded)
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
│   ├── robotAssembly.js            # Union-find grouping of bonded/attached parts into robots
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
- [x] Undo/redo (`Ctrl+Z` / `Ctrl+Y`) — command-stack history with transactions (1000-action cap; see History section)
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

### Visual Block Coding (Blockly)
- [x] **BlocksPanel** — drag-and-drop Blockly workspace as an alternative to the text CodeEditor
- [x] Custom Arduino hardware blocks (`arduinoBlocks.js`): setup/loop container, pin IO, timing, serial, servo — on top of Blockly's built-in logic/loops/math/text/variables
- [x] `arduinoGenerator.js` — a custom `Blockly.Generator` that emits Arduino C++ which the **existing** `arduinoParser`/`SimulationManager` already runs (no separate runtime)

### Mechanical Joints
- [x] **JointPanel** + `jointStore` + `JointManager`: parent↔child joints with types **fixed / hinge / revolute / slider / ball / servo**
- [x] Per-joint axis, angle/distance limits, and motor settings (speed, torque, target angle)
- [x] Fusion-style creation by picking a **corner / edge / face** feature in the viewport (`jointPickEvents`)
- [x] `JointManager` renders joint markers and drives the child object as the joint animates, propagating up the hierarchy each frame

### Mesh Editing — Fillet & Extrude
- [x] **FilletTool** (`FilletPanel`) — vertex-chamfer/bevel of sharp edges (radius + segments + min-angle); approximation for box-like and CSG geometries (no NURBS kernel). Unsupported on electronics primitives.
- [x] **ExtrudeTool** (`ExtrudePanel`) — extrude a chosen face of a BufferGeometry (box/sphere/cylinder caps/cone base/CSG)
- [x] **DimensionEditorPanel** — type exact W/H/D from the live bounding box; **Center** or **One-Sided** scaling (one face stays fixed)

### Robo-Sumo Battles
- [x] **BattleManager** — arena simulation: ring radius, accel/turn/friction, collision restitution, HP/lives, hit damage + cooldown; pushes live HP/status into `gameStore` for the **BattlePanel** HUD
- [x] **Local mode** — two robots on one machine, remappable per-player controls (with a `front` face setting to fix "W drives sideways")
- [x] **Online mode** — `NetworkManager` over **PeerJS** (WebRTC): host gets a room code, guest joins; STUN + free public TURN for NAT traversal; no custom server
- [x] Robots are whole assemblies — `robotAssembly.js` union-finds bonded + motor-attached parts into a single driven body

### Asset Library & Save
- [x] **AssetLibrary** — grouped shape/primitive palette plus user-saved assets
- [x] `assetStore` persists saved objects to **localStorage** (independent of the IndexedDB project store)

### View Gizmo & Robustness
- [x] **ViewGizmo** — standard-view buttons (top/front/right/back/left/bottom) + home, for quick camera snapping
- [x] **PanelErrorBoundary** — wraps side panels so a crash in one panel can't take down the whole editor

### Undo/Redo — Command-Stack History
- [x] Replaced the legacy 50-action snapshot stack with a **command-pattern** system in `src/managers/history/`
- [x] `Command` / `CompositeCommand` (nestable transactions, committed as one undo step) / `SnapshotCommand` (whole-slice fallback during migration)
- [x] **`editorDispatch.js`** is the single sanctioned entry point — every undoable edit funnels through it (fine-grained command or legacy snapshot bridge); nothing mutates the stacks directly
- [x] `historyStore` mirrors the stacks reactively for a debug panel; cap raised to **1000** actions

---

## Onboarding, Tutorial & Theme (UI Layer)

> **Hard rule:** everything in this layer is **UI/presentation only**. It *observes*
> app state (read-only) and never mutates physics, simulation, Arduino/Blockly
> execution, managers, stores, save/load, or networking.

### Onboarding module (`src/onboarding/`)
| File | Purpose |
|------|---------|
| `onboardingStore.js` | A **separate** Zustand store for UI-only onboarding state (welcome/tour/coach/modal flags, dismissed hints). Persists "seen" flags to **localStorage** — independent of the IndexedDB project save system. Never imports a manager. |
| `coachSteps.js` | Data for the interactive guided coach (27 steps): camera → create → transform → electronics → wiring → code → run → simulate. Each step has `selector` (a `data-tour` anchor), copy (why/how/cta/success), and a read-only `detect` rule. |
| `tourSteps.js` | Data for the passive product tour (10 panel highlights). |
| `missions.js` | Legacy passive checklist data (superseded by the coach; `MissionTracker` is no longer mounted). |

### Onboarding components (`src/components/onboarding/`)
- **`GuidedCoach.jsx`** — the interactive "teacher". Spotlights the target element, shows a coaching card, and **waits for real app state to change** before advancing. Overlay is `pointer-events-none` except the card, so the user interacts with the real UI. Includes collision-avoiding card placement, an arrow that sits in the gap, stuck-recovery (after 10 s), scroll-into-view for off-screen targets, and a `[Coach] …` debug trace (toggle `COACH_DEBUG` / `window.__COACH_DEBUG`).
- **`ProductTour.jsx`** — passive step-through that auto-switches panels and highlights each area.
- **`HelpMenu.jsx`** — the header **?** menu: Start/Restart Tutorial, Show Product Tour, Keyboard Shortcuts, Beginner Guide.
- **`KeyboardShortcutsModal.jsx`**, **`BeginnerGuideModal.jsx`** — reference modals.
- **`PanelHint.jsx`** — one-time contextual banner shown the first time each panel is opened.
- **`WelcomeOverlay.jsx`** (in `components/`) — first-run card with three entry paths (Teach me / Tour / Explore).

### Detection model (read-only)
Coach steps complete on **actual application state**, never on click/DOM events, so any input method (toolbar, keyboard `W/E/R`, future UI) works identically. Key signals:
- Tool **activation**: `uiStore.transformMode === translate|rotate|scale`
- Skill **execution**: object `position`/`rotation`/`scale` changed (baseline captured at step entry)
- **Run Code** (Arduino program executing): `electronicsStore.simulation.running` — *distinct from* **Start Simulation** (physics/drive): `uiStore.simActive`
- Panels: `uiStore.activePanel`; wiring: `connections` count; selection: `selectedId` / selected type

### `data-tour` anchors
Tutorial targeting is dynamic — elements expose `data-tour="…"` attributes the coach/tour query at runtime (e.g. `shape-box`, `mode-translate`, `elec-arduino`, `tab-code`, `code-run`, `panel`, `simulate`, `viewport`, `header`, `toolbar`). **Do not rename these without updating the step data.** Electronics categories in the toolbar default to *expanded* so these anchors always exist.

### Electronics organization
Components are grouped by role with collapsible headers + counts: **MCUs** (Arduino, SUBO) and **Actuators** (Servo, DC/BO Motor, LED) in both the left Toolbar and the Library. Only factory-supported types are addable; Sensors/Power/Communication appear as disabled "coming soon" so the taxonomy is taught without creating unsupported objects. Hover = name + purpose + example usage.

### Light theme / design system
- **Single lever:** the Tailwind `gray` ramp in `tailwind.config.js` is **inverted** — high numbers (700–950) → light surfaces, low numbers (50–500) → dark text — so every `bg-gray-*`/`text-gray-*`/`border-gray-*` flips to light without touching markup. Reverting the ramp restores dark mode.
- **Tokens:** bg `#F7F9FC` / panels `#FFFFFF` / surfaces `#F1F5F9` / borders `#E2E8F0`,`#94A3B8`; text `#1E293B` / `#475569` / `#64748B`; accent indigo `#4F46E5`; semantic emerald/amber/red/sky kept for success/warning/error/info.
- `globals.css` includes a critical rule: `input, textarea, select { color:#1E293B !important }` so form-field text is always dark on light fields (buttons excluded, so accent labels stay white).
- **Caveat:** the inversion flips *any* `text-gray-700/800` used as dark-text-on-white into a light value — use `slate-*` (default Tailwind, not in the inverted ramp) for dark text drawn directly on the white viewport/canvas. The 3D selection-highlight color lives in `sceneStore`/managers (guarded) and is intentionally left unchanged.

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

### Joint (jointStore)

```javascript
{
  id: "uuid",
  type: "hinge",          // fixed | hinge | revolute | slider | ball | servo
  parentId, childId,
  featureKind: null,      // 'corner' | 'edge' | 'face' — how it was created
  anchorPoint: { x, y, z },
  axis: { x: 0, y: 1, z: 0 },
  limits: { minAngle: -90, maxAngle: 90, minDist: 0, maxDist: 5 },
  motorSettings: { motorized: false, speed: 45, torque: 1.0, targetAngle: 0 },
  currentAngle: 0,
  currentPosition: 0,
  ballRot: { x, y, z },   // ball joint — per-axis rotation (°)
  visible: true,
  color: "#f59e0b",
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
- [x] Professional **light theme** (inverted Tailwind gray ramp + indigo accent)
- [x] **Interactive guided coach** (27 state-detected steps), product tour, help menu, beginner guide, contextual panel hints
- [x] **Categorized electronics** (MCUs / Actuators) in toolbar + library with readable labels and purpose tooltips
- [x] **Blockly visual block coding** → Arduino C++ (alternative to the text editor)
- [x] **Mechanical joints** (fixed/hinge/revolute/slider/ball/servo) with limits + motors
- [x] **Fillet/chamfer**, **face extrude**, and **typed dimension editing**
- [x] **Robo-sumo battles** — local two-player + online P2P (WebRTC/PeerJS)
- [x] **Asset library** with localStorage-saved assets
- [x] **Command-stack undo/redo** (transactions) via `editorDispatch`, plus ViewGizmo and per-panel error boundaries

### Remaining / Future
- [ ] STL export for 3D printing
- [ ] Boolean operations on CSG results (nested booleans)
- [ ] Object grouping / hierarchy
- [ ] Texture & normal map support
- [ ] Advanced lighting (point lights, spotlights, HDRI)
- [ ] Full BRep fillet (NURBS kernel) — current fillet is a vertex-chamfer approximation
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

**`npm run dev` crashes immediately with `EBUSY … dist/models/free_wheels.glb`**
→ A `vite preview` (or another process) is serving/holding the `dist/` folder, and the dev server's file watcher can't watch a locked file on Windows. **Stop any running `vite preview` first**, then `npm run dev`. Likewise, do **not** run `npm run build` while `npm run dev` is live — the build rewrites `dist/` and crashes the dev watcher the same way. (Run build and preview only when the dev server is stopped.)

**Dev/preview port keeps climbing (5173→5174…, 4173→4174…)**
→ A previously stopped Vite process is still releasing the port. Harmless — use the port Vite prints, or kill stray `node` processes to reset. Pin a port with `npm run preview -- --port 4180`.

**Tutorial arrow points at nothing / step won't advance**
→ The step's `data-tour` anchor was renamed/removed, or the target's detection signal changed. Anchors and `detect` rules live in `src/onboarding/coachSteps.js`; keep them in sync with the components.

**White/invisible text after a theme change**
→ Light theme inverts the `gray` ramp (see Theme section). Text meant to be dark on the white viewport must use `slate-*`, not `gray-700/800`. Inputs are force-darkened via a `globals.css` rule.

---

**Last Updated:** 2026-06-25  
**Version:** 1.4.0 (Blockly coding, mechanical joints, fillet/extrude, robo-sumo battles, command-stack history)
