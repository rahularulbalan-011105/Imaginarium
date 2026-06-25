# 3D Design Editor (Tinkercad Clone) — Project Documentation

## Project Overview

A web-based 3D object design and manipulation tool inspired by Tinkercad. Users can create, edit, and manage 3D objects in a browser-based editor without any login or authentication. Projects are stored locally in the browser using IndexedDB.

The editor has expanded well beyond a basic 3D modeller into a full robotics design, simulation, and gaming platform. It supports: parametric solid editing (extrude, fillet/chamfer, boolean CSG, geometry bending), mechanical joints, electronics wiring with both **text (Arduino C++)** and **visual (Blockly)** programming, wheeled and legged robot simulation with physics, a **Robo-Sumo "Battle" game mode** (local + online P2P), an asset library with external 3D model import, the custom **SUBO ESP32 board**, and Google Drive integration.

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
| **three-mesh-bvh** | BVH acceleration (raycasting, CSG) |
| **@dimforge/rapier3d-compat** | WASM rigid-body physics engine |
| **three-stdlib** | OrbitControls, TransformControls, GLTFLoader, etc. |
| **blockly** | Visual drag-and-drop Arduino programming (Blocks panel) |
| **peerjs** | WebRTC peer connections for online robo-sumo battles |
| **uuid** | Unique ID generation |
| **Vite** | Dev server and bundler |
| **playwright** (dev) | Headless screenshots for UI/theme verification |
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
│   ├── gearStore.js                # Gear mesh pairings (meshPairs)
│   ├── robotStore.js               # Robot blueprint / module state
│   └── historyStore.js             # Reactive mirror of undo/redo stacks (debug panel)
├── managers/
│   ├── SceneManager.js             # Three.js scene, renderer, camera, lighting, grid, named views
│   ├── ObjectManager.js            # Add/remove/update meshes; animateServo, animateLed, setBend, reattachLocal
│   ├── DriveManager.js             # Enters/exits simulation; routes to wheeled or legged path
│   ├── SimulationManager.js        # Runs Arduino/Subo code via arduinoParser transpiler
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
│       ├── LeggedSystem.js         # Auto-detect + drive hexapod/quadruped/biped robots
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
│   ├── useHistory.js               # Delegates to editorDispatch (legacy snapshot() bridge)
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
- [x] **Light/Dark theme toggle** (orange accent, CSS-variable token system, persisted; default dark)
- [x] **SUBO ESP32 board** (board-agnostic simulator + library API)
- [x] **Surface bonding** + **gear pairing** (`gearStore` meshPairs)
- [x] **Robot blueprint system** (`src/robot/` — ModuleLoader / RobotBlueprint / RobotRuntime, `robotStore`, RobotPanel)
- [x] **Share links**, **SVG import**, and **print/STL export** utilities; **Electron** desktop shell
- [x] Extra sensor models (ultrasonic, IR, gas, OLED, buzzer)

### Remaining / Future
- [ ] Boolean operations on CSG results (nested booleans)
- [ ] Online Battle matchmaking / lobby server (currently invite-by-code only)
- [ ] Object grouping / hierarchy
- [ ] Texture & normal map support
- [ ] Advanced lighting (point lights, spotlights, HDRI)
- [ ] Full BRep fillet (NURBS kernel) — current fillet is a vertex-chamfer approximation
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
