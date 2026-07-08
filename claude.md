# 3D Design Editor (Tinkercad Clone) — Project Documentation

## Project Overview

A web-based 3D object design and manipulation tool inspired by Tinkercad. Users can create, edit, and manage 3D objects in a browser-based editor without any login or authentication. Projects are stored locally in the browser using IndexedDB.

The editor has expanded well beyond a basic 3D modeller into a full robotics design, simulation, and gaming platform. It supports: parametric solid editing (extrude, fillet/chamfer, boolean CSG, slice, geometry bending), mechanical joints, electronics wiring with both **text (Arduino C++)** and **visual (Blockly)** programming, wheeled and legged robot simulation with physics, a **Robo-Sumo "Battle" game mode** (local + online P2P), an asset library with external 3D model import, the custom **SUBO ESP32 board**, a robot blueprint/AI runtime, and Google Drive / share-link / STL-print export.

The interface has been reworked into a **modern robotics design studio** (Tinkercad / Onshape / Figma / Blender-simplified feel): the 3D viewport is the primary surface, tools live in a compact **floating glass toolbox**, an **interactive View Cube** sits top-right, and a single **right-side icon-rail workspace** hosts every panel as a collapsible section.

**Status:** Post-MVP — full robotics platform · studio UI · light/dark theme · interactive onboarding
**Target Users:** Hobbyists, educators, makers, 3D-printing enthusiasts, robotics learners
**Platform:** Web (browser-based, responsive desktop) + Electron desktop shell, built with Vite

---

## Technology Stack

### Frontend Architecture

```
React 18 + Three.js + Zustand + Tailwind CSS + Vite  (+ Electron shell)
```

### Core Dependencies

| Package | Purpose |
|---------|---------|
| **React 18** | Component-based UI framework |
| **Three.js** (0.168) | 3D rendering engine |
| **Zustand** (5) | Lightweight state management |
| **Tailwind CSS** (3.4) | Styling (theme-token driven) |
| **three-bvh-csg** | Boolean CSG operations (union, subtract, intersect) |
| **three-mesh-bvh** | BVH acceleration (raycasting, CSG) |
| **@dimforge/rapier3d-compat** | WASM rigid-body physics engine |
| **three-stdlib** | OrbitControls, TransformControls, GLTFLoader, STLLoader, etc. |
| **blockly** (11) | Visual drag-and-drop Arduino programming (Blocks panel) |
| **peerjs** | WebRTC peer connections for online robo-sumo battles |
| **uuid** | Unique ID generation |
| **Vite** (5) | Dev server and bundler |
| **electron** / **electron-builder** (dev) | Desktop app packaging (`build:win`) |
| **playwright** (dev) | Headless screenshots for UI/theme verification |
| **gh-pages** (dev) | GitHub Pages deploy |

> **Install note:** new dependencies may need `npm install --legacy-peer-deps` (three-bvh-csg has a peer-dep conflict).

### Icons — no icon dependency

There is **no external icon library** (offline / strict-CSP / Electron safe). Every UI icon is either an inline SVG from the in-house set (`src/components/ui/Icon.jsx`, Lucide/Phosphor-style, `currentColor`) or an emoji/Unicode glyph inside content panels.

---

## Actual Project Structure

```
src/
├── App.jsx                         # Root — layout shell, render loop, keyboard shortcuts, bond propagation, right icon-rail
├── main.jsx
├── components/
│   ├── Viewport.jsx                # Three.js canvas, raycasting, gizmo wiring, attachment sync; hosts floating toolbox + view cube
│   ├── ViewportToolbox.jsx         # FLOATING glass toolbox (top-left): transform / surface-extrude-slice / snap+grid+axes / print bed
│   ├── ViewGizmo.jsx               # Interactive View Cube (top-right); fades out when any overlay opens
│   ├── Toolbar.jsx                 # DEPRECATED (old docked left sidebar) — no longer imported/mounted
│   ├── Header.jsx                  # Top bar: project name, theme toggle, Help(?), Save, File menu, Drive/share/STL
│   ├── PropertiesPanel.jsx         # Selected-object editor (transform, color, material, bend, fillet, dimensions, save-as-asset)
│   ├── DimensionEditorPanel.jsx    # Typed W/H/D bounding-box resize (center / one-sided locked-face)
│   ├── DimensionOverlay.jsx        # On-canvas size labels for selected objects
│   ├── ObjectList.jsx              # Scene hierarchy list, multi-select, visibility toggles
│   ├── AssetLibrary.jsx            # Library section: shapes (Basic/Polyhedra) + Text + Models + import (GLB/GLTF/STL/SVG) + saved assets
│   ├── ElectronicsLibrary.jsx      # Electronics section: MCUs (Arduino/SUBO) + Actuators (Servo/DC/BO/LED) + coming-soon; hosts elec-* anchors
│   ├── MechanicalLibrary.jsx       # Mechanical section: Gear / Bolt / Screw / Star creation
│   ├── BooleanPanel.jsx            # CSG boolean UI (union/subtract/intersect) — injected tab when two objects selected
│   ├── FilletPanel.jsx             # Chamfer/fillet edges of a selected mesh
│   ├── ExtrudePanel.jsx            # Face-extrude tool floating UI (Merge / Keep both / Cancel)
│   ├── SurfaceAttachPrompt.jsx     # Surface-patch selection / bonding prompt
│   ├── SlicePolylineOverlay.jsx    # Editable cut-line overlay for the Slice tool
│   ├── WiringPanel.jsx             # Pin-level wiring UI (per-component pin maps, state machine)
│   ├── ElectronicsPanel.jsx        # Legacy wire-connections editor (kept)
│   ├── JointPanel.jsx              # Mechanical joint editor (fixed/hinge/revolute/slider/ball/servo) + feature-pick
│   ├── RobotPanel.jsx              # Robot blueprint / module UI
│   ├── BlocksPanel.jsx             # Blockly visual coding workspace → Arduino C++ (lazy-loaded)
│   ├── CodeEditor.jsx              # Arduino C++ code editor + Templates + Run (hosts code-run anchor)
│   ├── SimulationPanel.jsx         # Sim section: Start/Stop simulation (hosts simulate anchor), environment, battle entry
│   ├── DrivePanel.jsx              # In-viewport sim HUD (wheeled + legged robot drive controls, serial log)
│   ├── BattlePanel.jsx             # Robo-sumo HUD (HP/lives bars, local + online setup)
│   ├── SettingsPanel.jsx           # Settings section: theme, grid/axes, snap, print bed (mirrors existing store actions)
│   ├── StatusBar.jsx               # Bottom status bar (object count, shortcut cheat-sheet)
│   ├── PanelErrorBoundary.jsx      # Wraps panels so a crash can't kill the editor
│   ├── WelcomeOverlay.jsx          # First-run entry card (Teach me / Tour / Explore)
│   ├── OverlayBridge.jsx           # Headless: mirrors onboarding flags into the overlay-priority coordinator (read-only)
│   ├── ui/
│   │   ├── Icon.jsx                # Inline-SVG icon set (~45 glyphs, currentColor) — the only iconography source
│   │   ├── surfaces.js             # Shared glassmorphism tokens (GLASS class + glassStyle) + icon-button styles
│   │   ├── overlay.js              # Reusable overlay-priority coordinator (useOverlay / useAnyOverlay)
│   │   └── zIndex.js               # Central z-index hierarchy constants (Z.*)
│   └── onboarding/                 # GuidedCoach, ProductTour, HelpMenu, KeyboardShortcutsModal, BeginnerGuideModal, PanelHint, MissionTracker(legacy)
├── stores/
│   ├── sceneStore.js               # Objects, selection, CSG objects, grid/axes, project meta
│   ├── uiStore.js                  # activePanel, transformMode, simActive, snap, print bed, surface/extrude/slice tool flags
│   ├── electronicsStore.js         # Components, connections, servo/motor attachments, Arduino code, simulation.running
│   ├── physicsStore.js             # Environment, gravity, wind, ground, legged robot control state
│   ├── rigidStore.js               # Rigid-body / surface-bond definitions (relativeMatrix)
│   ├── surfaceStore.js             # Surface-patch relationships
│   ├── jointStore.js               # Mechanical joints (type, axis, limits, motor settings)
│   ├── assetStore.js               # User-saved assets (localStorage-backed)
│   ├── gameStore.js                # Robo-sumo battle state + remappable controls
│   ├── gearStore.js                # Gear mesh pairings (meshPairs)
│   ├── robotStore.js               # Robot blueprint / module state
│   └── historyStore.js             # Reactive mirror of undo/redo stacks (debug panel)
├── managers/
│   ├── SceneManager.js             # Three.js scene, renderer, camera, lighting, grid, named views, transform gizmo, snap, print bed
│   ├── ObjectManager.js            # Add/remove/update meshes; animateServo/Motor/Led, setBend, reattachLocal, gear chains, bonds
│   ├── DriveManager.js             # Enters/exits simulation; routes to wheeled or legged path
│   ├── SimulationManager.js        # Runs Arduino/SUBO code via arduinoParser transpiler; motorSpeeds/servoAngles/ledBrightness
│   ├── WireManager.js              # Renders wire connections in 3D; drag-to-connect interaction
│   ├── JointManager.js             # Joint markers + constraint solving / child driving; createFeatureJoint
│   ├── ExtrudeTool.js              # Face extrusion on BufferGeometry
│   ├── FilletTool.js               # Vertex-chamfer / bevel on sharp edges
│   ├── BattleManager.js            # Robo-sumo simulation (arcade top-down ring physics, HP, hits)
│   ├── NetworkManager.js           # WebRTC P2P transport (PeerJS) for online battles
│   ├── StorageManager.js           # IndexedDB persistence + auto-save
│   ├── PatchManager.js             # Surface patches, face picking, extrude hover preview
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
├── robot/                          # Robot blueprint / module / AI system
│   ├── ModuleLoader.js · ModuleHost.js · RobotBlueprint.js · RobotRuntime.js
│   ├── PowerSystem.js · componentRegistry.js · modules.js
│   ├── autoBlueprint.js · blueprintBuilder.js
│   └── ai/ (AIRuntime.js, behaviors.js)
├── blockly/
│   ├── arduinoBlocks.js            # Custom Arduino hardware blocks + toolbox
│   └── arduinoGenerator.js         # Blockly → Arduino C++ code generator
├── onboarding/
│   ├── onboardingStore.js          # UI-only onboarding state (welcome/tour/coach/modal flags), localStorage
│   ├── coachSteps.js               # Guided-coach step data (27 steps)
│   ├── tourSteps.js                # Passive product-tour data (10 highlights)
│   └── missions.js                 # Legacy mission checklist (superseded)
├── hooks/
│   ├── useHistory.js               # Delegates to editorDispatch (legacy snapshot() bridge)
│   ├── useScene.js
│   └── useSelection.js
├── theme/
│   └── theme.js                    # getTheme / toggleTheme — sets data-theme on <html>, persists to localStorage
├── utils/
│   ├── geometryFactory.js          # Primitive geometry creators + applyBendDeform
│   ├── csg.js                      # runBoolean() — CSG with gizmo-correct positioning
│   ├── arduinoParser.js            # Full Arduino C++ lexer + parser + JS transpiler
│   ├── electronicsFactory.js       # Create electronics component meshes
│   ├── modelLoader.js              # GLTF/GLB/STL import + built-in GLB preloading/cloning
│   ├── svgImport.js                # svgTextToGeometry — extrude an SVG drawing into a solid
│   ├── sliceTool.js                # Plane/polyline slice of a mesh into two pieces
│   ├── robotAssembly.js            # Union-find grouping of bonded/attached parts into robots
│   ├── export.js                   # JSON/STL/GLTF export + import
│   ├── printExport.js              # STL export + printability analysis
│   ├── share.js                    # Share-link build/read (project packed into URL hash)
│   └── helpers.js                  # Utilities + buildProjectSnapshot (save/load) + snapRotationToAxes
└── styles/
    └── globals.css                 # Theme CSS variables (--g-* / --a-*), scrollbars, focus rings, theme-anim
```

> `public/models/` ships: `arduino_uno.glb`, `subo.glb`, `servo.glb`, `motor_dc.glb`, `motor_bo.glb`, `led.glb`, `free_wheels.glb`, plus sensor/peripheral models `ultrasonic.glb`, `ir_sensor.glb`, `gas_sensor.glb`, `oled.glb`, `buzzer.glb`.
> `electron/` ships `main.cjs` + `preload.cjs` for the desktop shell.

---

## UI Layout & Shell (current — "robotics design studio")

The app is **viewport-first**. `App.jsx` renders a vertical shell:

```
┌───────────────────────────────────────────────────────────────┐
│  Header  (logo · project name · ☀/🌙 theme · ? Help · Save · File) │  ← z-40
├───────────────────────────────────────────────────────────────┤
│                                        ┌──────────────┐ ┌────┐ │
│  ┌──────────┐          VIEWPORT         │ active right │ │icon│ │
│  │ floating │        (largest area)     │   section    │ │rail│ │
│  │ toolbox  │           + View Cube ↗   │  (full-hgt)  │ │    │ │
│  └──────────┘                           └──────────────┘ └────┘ │
├───────────────────────────────────────────────────────────────┤
│  StatusBar  (object count · shortcut cheat-sheet)               │
└───────────────────────────────────────────────────────────────┘
```

- **No permanent left sidebar.** The old docked `Toolbar` is removed from the layout (file kept but unmounted). Tools moved into the floating toolbox; object/electronics/mechanical creation moved into the right workspace.
- **Right workspace** = a full-height section panel + a slim **grouped icon rail** on the far right. Only one section shows at a time; the rail switches sections. The panel is drag-resizable (224–560 px).

### Floating Toolbox (`ViewportToolbox.jsx`) — top-left, glass

Compact (~176 px), glassmorphism (translucent `--g-900`, backdrop blur, rounded, soft shadow, ~200 ms transitions). Contains **only frequently-used modeling tools** (Blender/Fusion viewport-controls style) — it never creates objects:

| Group | Tools |
|---|---|
| Transform | **Move** `W` · **Rotate** `E` · **Scale** `R` (equal tiles, active = orange) |
| Solid edit | **Surface** (attach) · **Extrude** · **Slice** |
| Snap + View | **Move-snap** (Off/0.5/1/2) · **Rot-snap** (Off/15/45/90) · **Grid** `G` · **Axes** `A` |
| Print | **Bed** toggle · **Grid Size** (180/220/256/300 mm) |

Carries the `toolbar` container anchor and the `mode-translate|rotate|scale` transform anchors. Always mounted (incl. during simulation).

### Interactive View Cube (`ViewGizmo.jsx`) — top-right, glass

An iso cube whose **clickable faces** snap the camera (Top/Front/Right directly; a chevron pop-out exposes all six faces + Home/Iso). Reuses `sceneManager.setView()` / `getViewLabel()` only — no camera-control change. It is a **passive widget**: whenever any floating overlay is open it fades out (180 ms) and becomes non-interactive (see Overlay Layering).

### Right Workspace — icon rail + sections

Rail buttons carry `tab-<id>` anchors; the active section fills the panel. Grouped:

| Group | Sections (id) |
|---|---|
| Design | **Properties** (`properties`) · **Objects** (`objects`) · **Library** (`library`) |
| Create | **Electronics** (`electronics`) · **Mechanical** (`mechanical`) |
| Build | **Wiring** (`wiring`) · **Joints** (`joints`) · **Robot** (`robot`) |
| Program | **Blocks** (`blocks`) · **Code** (`code`) |
| Run | **Simulation** (`sim`) · **Battle** (`battle`) |
| Setup | **Settings** (`settings`) |

The **⊕ Boolean** section (`boolean`) is injected at the top of the rail only while two boolean-capable objects are selected (auto-focused; reverts to Properties when the pair is broken).

### Status bar & header

- **Header** (`z-40`): project-name input, **light/dark theme toggle**, Help `?` menu, Save (flash-confirms), File menu (New / Open / Export JSON / Import JSON / Copy Share Link / Export STL), Open-saved dialog.
- **StatusBar**: object count + inline keyboard cheat-sheet.

---

## Design System / Theme

The theme is a **CSS-variable token system** (not a Tailwind ramp hack). All colour flows from custom properties in `globals.css`:

- **Neutrals** `--g-50 … --g-950` (space-separated RGB channels, so Tailwind `<alpha-value>` opacity modifiers keep working).
- **Accent** `--a-50 … --a-950` — **orange** (`#F97316`) in both themes; only tint/text shades adapt.
- `tailwind.config.js` remaps `gray-*` → `--g-*`, `indigo-*` → `--a-*` (accent), and `slate-*` → the neutral **text** channels, so every existing `bg-gray-*` / `text-gray-*` / `*-indigo-*` / `slate-*` class flips automatically between themes with **no markup edits**.
- **Light/Dark toggle** lives in `src/theme/theme.js` (`getTheme`/`toggleTheme`) — it stamps `data-theme="light|dark"` on `<html>` and persists to localStorage. Default is **dark**. A `.theme-anim` class fades colours (~200 ms) around a toggle (colour props only, never transform/layout).
- **Form-field rule:** `input, textarea, select { color: rgb(var(--g-200)) !important }` keeps field text readable on both themes (buttons excluded so accent labels stay white). The Arduino editor keeps bright-green code text via `textarea.code-text`.
- **Always-white 3D canvas caveat:** text drawn directly on the viewport uses fixed hex (e.g. `#1E293B`/`#64748B`) instead of the flipping tokens.

### Shared surface tokens (`components/ui/surfaces.js`)

`GLASS` (rounded-2xl, border, shadow, backdrop-blur, 200 ms transition) + `glassStyle` (translucent fill, tinted border) + `ICON_BTN`/`iconBtnStyle` give every floating panel/toolbox/cube one consistent radius/elevation/blur/motion.

### Icon system (`components/ui/Icon.jsx`)

`<Icon name=… size=… />` renders one inline SVG from a ~45-glyph map (24×24, `stroke="currentColor"`, 1.75 px, rounded; play/stop are filled). Lucide/Phosphor-style, dependency-free, theme-inheriting. Used across the toolbox, view cube, right rail and chrome. Content panels (Library/Electronics/Mechanical) still use emoji for part glyphs.

---

## Overlay Layering System (reusable)

A small, reusable **overlay-priority coordinator** ensures passive viewport widgets (the View Cube) always yield to any floating popup/menu/modal.

- **`components/ui/overlay.js`** — a UI-only Zustand registry:
  - `useOverlay(id, isOpen)` — an overlay owner registers itself while open (auto-clears on close/unmount).
  - `useAnyOverlay()` — true when any overlay is registered.
- **`components/ui/zIndex.js`** — one source of truth for stacking:

  | Level | Constant | z | Examples |
  |---|---|---|---|
  | L1 | `viewport` | 0 | 3D canvas |
  | L2 | `toolbox` | 20 | floating toolbox |
  | L3 | `viewCube` | 30 | View Cube (yields to overlays) |
  | L4 | `dropdown` | 40 | header menus, context menus |
  | L5 | `dialog` | 50 | Open-project dialog |
  | L6 | `coach` | 120 | guided tutorial coach |
  | L7 | `modal` | 130 | shortcuts / beginner-guide modals |
  | L8 | `toast` | 200 | global notifications |

- **`components/OverlayBridge.jsx`** — headless adapter mounted in `App`; it *reads* `onboardingStore` flags (welcome/tour/coach/shortcuts/guide) and registers matching overlay ids, so tutorials suppress the cube **without editing any tutorial component**.
- **Consumers today:** Help menu, File menu, Open-saved dialog, and (via the bridge) welcome/tour/coach/shortcuts/guide. **Any future dropdown/dialog/modal opts in with one line** — `useOverlay('id', open)` — and the cube steps aside automatically.
- **View Cube behaviour when suppressed:** `opacity: 0` (180 ms fade) + `pointer-events: none` + `aria-hidden` on its interactive panels + pop-out force-closed. No hover / click / accidental camera move; restores automatically. It stays mounted → **no layout shift**. The header is a `relative z-40` stacking context so its dropdowns sit above the cube even during the fade.

---

## Right-Panel Sections (App.jsx `RAIL` / `renderPanelBody`)

`activePanel` (uiStore) is a free-form string. Sections:

- **Properties** — full object editor: name, transform, color, material, bend, fillet, dimension editor, save-as-asset.
- **Objects** — scene hierarchy list, multi-select, visibility toggles, delete.
- **Library** (`AssetLibrary`) — Basic + Polyhedra shapes, **Text**, built-in **Models**, file **import (GLB/GLTF/STL/SVG)**, saved assets. Hosts the `shape-box` anchor (Cube button).
- **Electronics** (`ElectronicsLibrary`) — MCUs (Arduino/SUBO) + Actuators (Servo/DC/BO Motor/LED) + "coming soon" (Sensors/Power/Comms). Hosts `elec-*` anchors.
- **Mechanical** (`MechanicalLibrary`) — Gear / Bolt / Screw / Star.
- **Wiring** — pin-to-pin connection editor.
- **Joints** — mechanical-joint editor + feature-pick creation.
- **Robot** — robot blueprint / module UI.
- **Blocks** — Blockly workspace (lazy-loaded), wrapped in an error boundary.
- **Code** — Arduino C++ editor + Templates + Run (`code-run` anchor).
- **Simulation** (`SimulationPanel`) — Start/Stop Simulation (`simulate` anchor), Environment (Earth/Moon/Mars/Zero-G), Robo-Sumo entry.
- **Battle** — robo-sumo HUD/setup, wrapped in an error boundary.
- **Settings** (`SettingsPanel`) — theme, grid/axes, snap (move/rot), print bed/size (all mirror existing store actions).

---

## Implemented Features

### 3D Viewport & Scene
- [x] Three.js WebGL renderer with orbit camera (OrbitControls)
- [x] TransformControls gizmo — move / rotate / scale (`W`/`E`/`R`; scale blocked for electronics)
- [x] Raycasting object selection (click), shift-click a 2nd object for booleans
- [x] Toggleable grid (`G`) and coordinate axes (`A`); ambient + directional lighting with shadows
- [x] Object selection highlight (emissive outline); on-canvas dimension overlay
- [x] **Interactive View Cube** — clickable faces Top/Front/Right/Back/Left/Bottom + Home (iso); auto-hides under overlays
- [x] Snap-to-grid (translate + rotate); 3D-print build-plate overlay
- [x] Drag-and-drop model import onto the canvas

### Shape Creation (right-panel Library)
- [x] Primitives: Cube, Sphere, Cylinder, Cone, Rect Box, Plane, Torus, Capsule
- [x] Polyhedra: Tetrahedron, Octahedron, Dodecahedron, Tri-Prism, Hex-Prism, Sq-Pyramid, Pent-Pyramid
- [x] **Text** solids; **SVG import** → extruded solid; external **GLB/GLTF/STL** import; built-in models (Wheels)
- [x] Keyboard `1`–`0` add primitives (see shortcuts); saved-asset templates (`assetStore`, localStorage)

### Object Manipulation
- [x] Real-time transform via Properties (position, rotation, per-axis & uniform scale)
- [x] **Dimension Editor** — typed W/H/D; center or one-sided (locked-face) scaling
- [x] Color picker (hex + swatch); Materials: Standard / Metallic / Transparent
- [x] Rename inline · Duplicate (`Ctrl+D`, smart repeat) · Copy/Paste (`Ctrl+C`/`V`) · Delete · Show/Hide
- [x] **Geometry bending** — cylindrical bend deform (axis X/Y/Z, −180°→+180°, idempotent, resettable)
- [x] Nudge with arrow keys (snap step); snap rotation to axes (`Shift+S`)

### Solid Editing / CAD Tools
- [x] **Boolean CSG**: Union, Subtract A−B, Subtract B−A, Intersect — gizmo-correct centering
- [x] **Extrude** (`ExtrudeTool`): pick a face → side walls → Merge (CSG union) / Keep both / Cancel
- [x] **Fillet / Chamfer** (`FilletTool`): vertex-displacement bevel; radius/segments/edge-angle; result becomes CSG
- [x] **Slice** (`sliceTool` + `SlicePolylineOverlay`): draw a line across a shape to cut it in two
- [x] **Mechanical Joints** (`JointManager` + `jointStore`): fixed/hinge/revolute/slider/ball/servo; axis, limits, motor; Fusion-style feature picker (corner/edge/face)
- [x] **Surface bonding** (`surfaceStore` + `SurfaceAttachPrompt`): connect two patches → bond in `rigidStore` (`relativeMatrix`), propagated every frame
- [x] **Gear pairing** (`gearStore.meshPairs`)

### Scene Management
- [x] Object list with visibility toggles; multi-select (Shift+click)
- [x] Undo/redo (`Ctrl+Z`/`Ctrl+Y`) — command-stack history with transactions (1000-action cap)
- [x] `Ctrl+G` group (CSG combine) / `Ctrl+Shift+G` ungroup
- [x] Auto-save to IndexedDB (every 30 s); Save / Open / Delete projects
- [x] Export JSON / STL / GLTF; Import project JSON; **Copy Share Link** (project packed into URL hash)

### Electronics System
- [x] Arduino, **SUBO**, servo, DC/BO motor, LED, sensor/peripheral models
- [x] **WiringPanel** — pin-to-pin editor (state machine, GND/5V fan-out); 3D wire tubes (`WireManager`)
- [x] **CodeEditor** — Arduino C++ panel + Templates + Run/Serial Monitor
- [x] **BlocksPanel** — Blockly visual programming (lazy ~700 KB) → Arduino C++ via `arduinoGenerator`; persisted as `blocksJson`
- [x] **Arduino simulation** via full C++ lexer+parser+transpiler (`arduinoParser.js`): variables, functions, control flow, structs; API (`pinMode`, `digitalWrite`, `analogWrite/Read`, `delay`, `Serial.*`, `Servo.write`, `millis()`, …)
- [x] **SUBO library API** injected into the simulator; board-agnostic simulator maps `D<n>`/`IO<n>` → GPIO
- [x] Servo attachment (arms animate on `Servo.write()`); LED animation; bond propagation each frame

### Physics Simulation
- [x] **Rapier WASM** rigid-body physics (`PhysicsManager.js`)
- [x] **Kinematic fallback integrator** (`PhysicsIntegrator.js`) — inertia lag, air drag, rolling friction, wind
- [x] **MassCalculator** — volume × material density mass; moment of inertia; frontal area for drag
- [x] **Environment presets** (`EnvironmentConfig.js`): Earth, Moon, Mars, Zero-G (chosen in the Simulation section)
- [x] Wind (direction + speed + turbulence). Scale: 1 scene unit = 0.05 m (5 cm)

### Wheeled Robot Simulation
- [x] Auto-detect differential-drive robots (≥2 motors wired to Arduino)
- [x] `analogWrite(pin, speed)` → motor speed → `DifferentialDrive` → linear/angular velocity
- [x] Body moves with physics (friction, drag, gravity); DrivePanel HUD run/stop + serial log

### Legged Robot Simulation
- [x] Auto-detect hexapod / quadruped / biped from servo+arm pairs
- [x] **GaitEngine**: tripod (6), trot (4), alternating (2–3); IK foot targets → servo angles
- [x] DrivePanel legged mode: D-pad + arrow keys (only when `isLeggedRobot`); gait skipped while Arduino code runs so `Servo.write()` wins

### Robo-Sumo "Battle" Game Mode
- [x] Push opponent out of the ring / drain HP by ramming; 100 HP, 3 lives, best-of-3
- [x] **Local 2-player** (P1=WASD, P2=arrows) and **online 2-player** via WebRTC/PeerJS (5-char room codes, STUN + free TURN)
- [x] **Split-authority netcode**: each client simulates its own robot; opponent proxy upgraded to full streamed geometry (one mesh per message, backpressure-paced)
- [x] **Arcade top-down physics** (discs on ring plane), NOT Rapier; robots detected as assemblies via `robotAssembly.js`

### Robot Blueprint / AI System (`src/robot/`)
- [x] `RobotBlueprint` / `ModuleLoader` / `ModuleHost` / `RobotRuntime`, `PowerSystem`, `componentRegistry`, `modules`
- [x] `autoBlueprint` / `blueprintBuilder` (derive a blueprint from the scene) + `ai/` (`AIRuntime`, `behaviors`); surfaced in **RobotPanel** / `robotStore`

### Import / Export / Share
- [x] Google Drive save/load (`DriveManager` OAuth + Drive API) via Header
- [x] JSON / STL / GLTF export; STL export with **printability analysis** (`printExport.js`); share links (`share.js`)

### Onboarding, Tutorial & Theme (UI-only)
- [x] First-run **WelcomeOverlay**, **GuidedCoach** (27 state-detected steps), **ProductTour** (10 highlights), **HelpMenu**, **KeyboardShortcutsModal**, **BeginnerGuideModal**, per-panel **PanelHint**
- [x] Light/Dark theme toggle (orange accent, CSS-variable tokens, persisted)

### Undo/Redo — Command-Stack History
- [x] Command-pattern system in `src/managers/history/`; `Command`/`CompositeCommand`/`SnapshotCommand`
- [x] **`editorDispatch.js`** is the single sanctioned mutation entry point; `historyStore` mirrors the stacks; 1000-action cap

---

## Onboarding, Tutorial & Overlay layer (UI Layer)

> **Hard rule:** everything in this layer is **UI/presentation only**. It *observes*
> app state (read-only) and never mutates physics, simulation, Arduino/Blockly
> execution, managers, application stores, save/load, or networking.

### Onboarding module (`src/onboarding/`)
| File | Purpose |
|------|---------|
| `onboardingStore.js` | A **separate** Zustand store for UI-only onboarding state (welcome/tour/coach/modal flags, dismissed hints). Persists "seen" flags to **localStorage**. Never imports a manager. |
| `coachSteps.js` | Data for the interactive guided coach (27 steps): camera → create → transform → electronics → wiring → code → run → simulate. Each step has `selector` (a `data-tour` anchor), copy, and a read-only `detect` rule. |
| `tourSteps.js` | Data for the passive product tour (10 highlights). |
| `missions.js` | Legacy passive checklist data (superseded by the coach; `MissionTracker` not mounted). |

### Onboarding components (`src/components/onboarding/`)
- **`GuidedCoach.jsx`** — interactive "teacher": spotlights the target element (via `document.querySelector([data-tour])` + `getBoundingClientRect`, re-measured every 400 ms with scroll-into-view), waits for real app state to change, `pointer-events-none` except its card. `[Coach]` debug trace (`window.__COACH_DEBUG`).
- **`ProductTour.jsx`** — passive step-through; auto-switches right sections.
- **`HelpMenu.jsx`** — header **?** menu: Start/Restart Tutorial, Product Tour, Keyboard Shortcuts, Beginner Guide. Registers itself as an overlay (`useOverlay('help-menu', open)`).
- **`KeyboardShortcutsModal.jsx`**, **`BeginnerGuideModal.jsx`** — reference modals.
- **`PanelHint.jsx`** — one-time banner the first time each section opens.
- **`WelcomeOverlay.jsx`** (in `components/`) — first-run card (Teach me / Tour / Explore).

### Detection model (read-only)
Coach steps complete on **actual application state**, never on click/DOM events. Key signals: `uiStore.transformMode`; object position/rotation/scale deltas; `electronicsStore.simulation.running` (Run Code) vs `uiStore.simActive` (Start Simulation); `uiStore.activePanel`; connection count; selection type; camera orbit/zoom/pan.

### `data-tour` anchors (current homes)
| Anchor | Lives on |
|---|---|
| `viewport` | Viewport container |
| `toolbar` | Floating **ViewportToolbox** root |
| `mode-translate` / `mode-rotate` / `mode-scale` | Toolbox transform tiles |
| `shape-box` | **AssetLibrary** (Library section) Cube button |
| `elec-arduino` / `elec-motor_bo` / `elec-*` | **ElectronicsLibrary** (Electronics section) |
| `simulate` | **SimulationPanel** Start/Stop button |
| `tab-<id>` | Right icon-rail buttons (properties, objects, library, electronics, mechanical, wiring, joints, robot, blocks, code, sim, battle, settings, boolean) |
| `panel` | Right workspace container |
| `code-run` | CodeEditor Run button |
| `header` / `help` | Header / Help-menu wrapper |

**Do not rename these without updating `coachSteps.js` / `tourSteps.js`.** Creation anchors (`shape-box`, `elec-*`, `simulate`) now live in their right-panel sections; the coach re-measures on an interval, so the spotlight attaches once the relevant section is open, and every step still completes via state detection regardless (keyboard/other input).

---

## Data Models

### Scene Object (sceneStore)
```javascript
{
  id: "uuid",
  name: "Cube_1",
  type: "box",           // box | sphere | cylinder | cone | torus | plane | capsule | prism | hexagon
                         //  | tetrahedron | octahedron | dodecahedron | pyramid | pentpyramid | rectprism
                         //  | text | star | gear | bolt | screw | csg | model | <electronics-type>
  position: { x, y, z },
  rotation: { x, y, z },
  scale:    { x, y, z },
  color: "#ff6b6b",
  material: "standard",  // standard | metallic | transparent
  visible: true,
  deform: { bend: 45, bendAxis: "y" },     // optional — only when bent
  attach: { motorId, position, quaternion, scale },  // optional — local transform inside a motor rotor
  modelKey: "free_wheels",                 // optional — built-in GLB key (survives reload)
  metadata: { createdAt, updatedAt }
}
```

### CSG Object (sceneStore.addCSGObject)
```javascript
addCSGObject(name, geometryJSON, color, position)   // position = bounding-box center (gizmo anchor)
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
  currentAngle: 0, currentPosition: 0,
  ballRot: { x, y, z }, visible: true, color: "#f59e0b",
}
```

### Physics Store
```javascript
{
  environment: 'earth',        // earth | moon | mars | zero_g
  gravity: -9.80665, airDensity: 1.225,
  groundFriction: 0.7, rollingFriction: 0.015,
  wind: { x, z, speed, turbulence }, groundType: 'concrete',
  isLeggedRobot: false, leggedControl: { speed: 0, turn: 0 }, leggedGaitType: 'auto',
}
```

### UI Store (uiStore)
```javascript
{
  activePanel: 'properties',   // any section id (free-form string)
  transformMode: 'translate',  // translate | rotate | scale
  simActive: false,
  snapTranslate: 0, snapRotateDeg: 0,       // 0 = off
  printBedVisible: false, printBedSizeMm: 220,
  surfaceToolActive, extrudeToolActive, sliceToolActive, extrudeState,
}
```

---

## Key Architecture Decisions

### State ↔ Managers separation
~12 Zustand **stores** hold declarative state; **managers/** hold imperative Three.js / physics / network logic; **utils/** are pure helpers. Components subscribe to stores and call manager methods. The onboarding + overlay layers are a strictly read-only presentation overlay.

### Overlay layering (reusable)
Passive viewport widgets defer to any open popup via a central registry (`ui/overlay.js`) and z-scale (`ui/zIndex.js`); `OverlayBridge` mirrors onboarding flags in so tutorials are untouched. Adding a new overlay = one `useOverlay(id, open)` call. (See "Overlay Layering System".)

### Undo/Redo (command-pattern)
Command-stack under `src/managers/history/`: `Command`/`CompositeCommand`/`SnapshotCommand`; `HistoryManager` (nestable transactions, 1000-cap, mirrors into `historyStore`); **`editorDispatch.js`** is the single dispatch facade (`execute`, `transaction`, `recordSnapshot` legacy bridge, `undo`/`redo`, `captureCanonical`/`restoreCanonical`, `resetBaseline`/`clear`). `useHistory.js` delegates to it so the ~47 legacy `snapshot()` sites keep working. Canonical snapshot = 5 slices (objects, attachments, bonds, patches, joints). Viewport gizmo drag records **one** canonical `recordSnapshot('transform')` after the bond-matrix update. Save/load stays separate on the `'1.0'` format — never write history into project files.

### CSG Gizmo Positioning
After `evaluator.evaluate()` (three-bvh-csg) vertices are in world space. `csg.js` recenters the geometry at its bounding-box midpoint and returns `position` so the mesh sits at the visual center and the gizmo lands correctly:
```js
result.geometry.computeBoundingBox()
const center = new THREE.Vector3(); result.geometry.boundingBox.getCenter(center)
result.geometry.translate(-center.x, -center.y, -center.z)
return { geometryJSON, color, position: { x: center.x, y: center.y, z: center.z } }
```
`BooleanPanel`/`FilletPanel`/`ExtrudePanel` pass `result.position` to `addCSGObject`.

### Geometry Bending (`applyBendDeform`)
Cylindrical bend: `R = H / θ`. Saves original positions in `geometry.userData.origPos` (idempotent). Axis permutation: Y-bend (h=y,a=z,b=x); Z-bend (h=z,a=x,b=y); X-bend (h=x,a=y,b=z). Skipped for CSG objects.

### Legged vs Wheeled Detection (`DriveManager.enter()`)
1. Count motors wired to Arduino → `≥2` → wheeled path. 2. Else check servo objects with children in `attachments`. 3. If `LeggedSystem.build()` finds ≥2 servo+arm leg pairs → legged path; `setIsLeggedRobot(true)`.

### Robot Assembly Grouping (`robotAssembly.js`)
Union-find over surface bonds (rigidStore) + motor attachments (electronicsStore) partitions the scene into connected components with a `rootId`. Used by Battle and simulation to move parts as one unit. Bond propagation is **skipped during battle** (BattleManager owns positions).

### Arduino Transpiler & Board-Agnostic Simulator
Recursive-descent parser in `arduinoParser.js` (lexer → typed tokens → parser → JS codegen, run in a sandboxed eval with Arduino API shims). Any pin named `D<n>`/`IO<n>` → GPIO, so **SUBO** reuses it unchanged (SUBO constants + library prepended). Blockly programs convert to the same C++ via `arduinoGenerator` before running.

### Registering a New Controller Board (e.g. SUBO)
Files that key off `'arduino'`: `modelLoader` (MODEL_PATHS + scale), `electronicsFactory` (PIN_DEFS + create*Group + addPinSpheres), `ObjectManager` (ELECTRONICS set + createMesh dispatch), `sceneStore` (isElectronics + default pos), `AssetLibrary`/`ElectronicsLibrary` (buttons), `WiringPanel` (ELEC_TYPES + PIN_DEFS + COMP_ICONS), `CodeEditor` (hasArduino), `App` (ELEC_TYPES), `Viewport`/`PropertiesPanel`/`BooleanPanel`/`FilletPanel` (isElectronics lists), `MassCalculator`.

### Online Battle Geometry Streaming
`getRobotGeo` sends every real leaf mesh (incl. GLB internals) as records (positions+index+normals+per-leaf material+relative matrix); reparented children attributed via `ownerOf`/`memberOf`. Sends are **backpressure-paced** (`_sendPaced` waits for `dataChannel.bufferedAmount` < 64 KB). Receiver requests re-streams (`georeq`) on stalls. Orientation preserved via `geometa` (rest quaternion + front angle + baseY, captured at REST).

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `W` / `E` / `R` | Gizmo Translate / Rotate / Scale (Scale blocked for electronics) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste selected (non-electronics) |
| `Ctrl+D` | Duplicate selected (smart repeat-array on subsequent presses) |
| `Ctrl+G` / `Ctrl+Shift+G` | Group (CSG) / Ungroup selected pair |
| `Delete` / `Backspace` | Delete selected (or selected surface patches) |
| `1`–`0` | Add primitive: 1 cylinder · 2 cone · 3 cube · 4 sphere · 5 tetrahedron · 6 sq-pyramid · 7 pent-pyramid · 8 octahedron · 9 dodecahedron · 0 rect-prism |
| `G` / `A` | Toggle grid / axes |
| `F` | Frame/fit selection (or reset camera) |
| `Shift+S` | Snap selected rotation to nearest axes |
| `↑↓←→` | Nudge selected by snap step (Shift = vertical Y); drives legged robot during legged sim |
| `WASD` / `↑↓←→` | Battle mode: P1 / P2 drive (editor shortcuts blocked while a battle is active) |
| `Escape` | Deselect all / cancel active tool pick |
| Mouse | Wheel = Zoom · Middle-drag = Orbit · Right-drag = Pan |

---

## Setup & Running

```bash
npm install            # add --legacy-peer-deps if peer-dep conflicts appear
npm run dev            # Vite dev server → http://localhost:5173/Imaginarium/  (note the /Imaginarium/ base path)
npm run build          # Production build
npm run preview        # Serve the built dist/  (pin a port: npm run preview -- --port 4180)
npm run deploy         # Build + publish dist/ to gh-pages
npm run electron       # Launch the Electron desktop shell
npm run build:win      # Build + package a Windows app (electron-builder)
```

**Note:** Rapier WASM (`@dimforge/rapier3d-compat`) loads asynchronously on startup; physics requires it to initialize before `DriveManager.enter()`. The dev/preview URL includes the `/Imaginarium/` base path from `vite.config.js`.

---

## 3D Asset Tooling — MCP (Blender + fal.ai)

Built-in board/sensor models live in `public/models/*.glb` (e.g. `subo.glb`, `arduino_uno.glb`). To **author or regenerate** those assets, two MCP servers are wired up for the Claude Code CLI via a project-scoped config. This is a dev/authoring workflow only — it is **not** part of the app runtime or the Vite build.

- **Config:** `.mcp.json` in the repo parent (`d:\AtumX\imaginarium\toolsapp (2)\`), alongside `.env` (holds `FAL_KEY`, gitignored). Full walkthrough in `MCP_SETUP.md`.
- **`blender`** — official Blender Lab MCP (stdio). Server: `blender-mcp.exe` (installed via `uv tool install`); needs the **MCP add-on running inside Blender** (Auto-Start, `localhost:9876`). Tools: `execute_blender_code`, `get_objects_summary`, `render_viewport_to_path`, `get_screenshot_of_window_as_image`, `get_python_api_docs`, … → model/inspect/render GLB assets.
- **`fal-ai`** — hosted HTTP MCP (`https://mcp.fal.ai/mcp`), `Authorization: Bearer ${FAL_KEY}`. Tools: `run_model`, `submit_job`, `search_models`, `check_job` → text/image→3D generation.

**Gotchas:** MCP servers register only in the `claude` **CLI** (trust the project-MCP prompt on first launch; verify with `/mcp` or `claude mcp list`) — not inside the IDE extension. Claude Code does **not** auto-load `.env`; `FAL_KEY` must also be in the process env (`setx FAL_KEY "…"`, then reopen the terminal). If `blender` fails to connect, confirm Blender's add-on panel reads "Server is running" (port 9876).

**Calibration reminder:** GLBs authored/exported here can be mixed-unit or off-scale. The loader normalises each model's longest bbox dim to `MODEL_SCALE_TARGET[type]` (`modelLoader.js`) and `electronicsFactory.js` anchors pins to the real substrate — so a newly generated `subo.glb` gets sized/centred automatically, but re-verify pins/matrix alignment after any re-export (see the SUBO troubleshooting entries).

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
# Deploy dist/ as a static site (npm run deploy publishes to gh-pages)
```

GitHub Pages base path is in `vite.config.js`. COOP/COEP headers must be set for Rapier WASM SharedArrayBuffer support. `netlify.toml` / `vercel.json` provide host configs; Electron uses a relative base (`build:electron`).

---

## Development Roadmap / Changelog

### Completed
- [x] Core viewport, orbit camera, transform gizmo; all primitives + polyhedra + Text + SVG + GLB/GLTF/STL import
- [x] Properties (transform/color/material/bend/fillet/dimensions); object list; undo/redo; local + IndexedDB storage
- [x] Electronics (Arduino/SUBO, servos, motors, LEDs, wiring); Arduino C++ transpiler simulation; Blockly visual coding
- [x] Boolean CSG (gizmo-correct); geometry bending; **slice**; **fillet/chamfer**; **face extrude**; typed dimension editing
- [x] Physics (Rapier + kinematic fallback), Earth/Moon/Mars/Zero-G, wind; wheeled + legged (auto-gait) robot sim
- [x] Robo-sumo battles — local + online P2P (WebRTC/PeerJS); robot assembly grouping
- [x] Mechanical joints (fixed/hinge/revolute/slider/ball/servo) with limits + motors; surface bonding; gear pairing
- [x] **Robot blueprint / module / AI system** (`src/robot/`, RobotPanel, robotStore)
- [x] Google Drive integration; share links; STL/print export with printability check; Electron desktop shell; extra sensor models
- [x] Command-stack undo/redo (transactions) via `editorDispatch`; per-panel error boundaries
- [x] **Light/Dark theme** — CSS-variable token system, orange accent, persisted (default dark)
- [x] **Interactive guided coach** (27 steps), product tour, help menu, beginner guide, panel hints
- [x] **UI Phase 4 — Studio redesign:** removed the docked left sidebar; added the floating glass **ViewportToolbox**, interactive **View Cube**, in-house **inline-SVG icon set**, shared **glass surface tokens**, and the single right **icon-rail workspace** with grouped sections incl. new **Simulation** + **Settings** sections
- [x] **UI Phase 4.1 — Toolbox simplification:** floating toolbox reduced to transform / surface-extrude-slice / snap+grid+axes / print-bed only; all object/electronics/mechanical creation relocated to dedicated **Library / Electronics / Mechanical** right-panel sections (no duplication); Text + SVG import folded into Library
- [x] **UI overlay-layering fix:** reusable overlay-priority coordinator (`ui/overlay.js` + `ui/zIndex.js` + `OverlayBridge`); the View Cube auto-fades and disables interaction whenever any dropdown/dialog/modal/tutorial overlay is open
- [x] **SUBO GLB calibration:** the official `subo.glb` is the visible board (never procedural). It is a MIXED-UNIT hierarchy — several `*PCB*` meshes span the full board (~6.45×6.8) while others are tiny sub-parts (down to ~0.3). `suboBoardBox()` (`electronicsFactory.js`) anchors pins + LED-matrix panel to the **largest** `/pcb/i` mesh (the real substrate) so they span the board instead of collapsing onto a sub-part. `MODEL_SCALE_TARGET.subo = 6.8` = Arduino, so both normalise to the same footprint; the board is laid flat (rests on the workplane)
- [x] **Pin reveal system (hidden-until-needed):** pin spheres + label sprites are hidden by default (`WireManager.setReveal`) so every GLB board reads as real hardware, not a cloud of helpers. Pins appear only while the **Wiring** panel is open (all boards) or a board is **selected** (that board); individual pins still brighten on hover, and a live wire-drag reveals all pins as targets. `_raycastPins` only targets active pins. Applies uniformly to Arduino / SUBO / sensors

### Remaining / Future
- [ ] Boolean operations on CSG results (nested booleans)
- [ ] Online Battle matchmaking / lobby server (currently invite-by-code only)
- [ ] Object grouping / hierarchy; texture & normal-map support; advanced lighting (point/spot/HDRI)
- [ ] Full BRep fillet (NURBS kernel) — current fillet is a vertex-chamfer approximation
- [ ] Mobile responsiveness
- [ ] SUBO: 3D LED-matrix lighting, buzzer audio, A/B buttons as `digitalRead` inputs

---

## Troubleshooting

**View Cube overlaps the Help/Tutorial menu (or any popup)**
→ Fixed: the cube reads `useAnyOverlay()` and fades out + disables pointer events while any overlay is open. Register new overlays with `useOverlay('id', open)` (see Overlay Layering).

**A tool/feature "disappeared" from the toolbox**
→ Object/electronics/mechanical creation moved to the right workspace (Library / Electronics / Mechanical sections). The floating toolbox intentionally holds only transform + surface/extrude/slice + snap/grid/axes + print-bed.

**Tutorial arrow points at nothing / step won't advance**
→ The step's `data-tour` anchor moved or its detection signal changed. Creation anchors (`shape-box`, `elec-*`, `simulate`) live in their right-panel sections — open that section and the spotlight attaches; steps still complete on state detection. Anchors/rules live in `src/onboarding/coachSteps.js`.

**Undo after a gizmo drag wipes the scene**
→ Fixed: the drag records one canonical `recordSnapshot('transform')` (5-slice).

**Gizmo appears at wrong location after Boolean/Fillet/Extrude**
→ `csg.js` recenters geometry at the bounding-box origin and returns `position`; the panel passes it to `addCSGObject`.

**Servo arms / attached wheels don't animate or fly apart on reimport**
→ Arm must be in `attachments` (electronicsStore) with the servo's ID. `propagateAllBonds()` runs every frame; on load, `reattachLocal(objectId, motorId, obj.attach)` restores the exact local transform (retries up to 20× while the GLB loads).

**Online Battle opponent is invisible or upside-down**
→ Geometry must be streamed per-mesh with backpressure pacing; orientation needs `geometa` (rest quaternion). See Online Battle Geometry Streaming.

**Rapier physics not working**
→ Rapier WASM must finish loading before simulation; ensure COOP/COEP headers (SharedArrayBuffer) in production.

**A panel crashed and took focus**
→ Panels are wrapped in `PanelErrorBoundary`; use its Retry button. The rest of the editor stays alive.

**SUBO board pins/matrix collapse to a tiny dot at the board centre**
→ `subo.glb` is a mixed-unit hierarchy; the *first* `/pcb/i` mesh is a ~0.3-unit sub-part. `suboBoardBox()` (in `electronicsFactory.js`) must anchor pins + the LED matrix to the **largest** `/pcb/i` mesh (the real substrate). Don't revert to "first pcb mesh."

**SUBO/Arduino pins aren't visible in the viewport**
→ Pins are hidden until needed. Open the **Wiring** panel (reveals every board's pins) or **select** the board (reveals its pins). See `WireManager.setReveal` — driven by an effect in `App.jsx` keyed on `activePanel` + `selectedId`. Individual pins also brighten on hover; a live wire-drag reveals all pins as targets.

**White/invisible text after a theme change**
→ Colour comes from `--g-*`/`--a-*` tokens; text drawn directly on the always-white 3D canvas uses fixed hex (`slate-*`/`#…`), not the flipping tokens. Inputs are force-darkened via a `globals.css` rule.

**`npm run dev` crashes with `EBUSY … dist/models/free_wheels.glb`**
→ A `vite preview` (or a build) is holding `dist/`. Stop any preview/build first, then `npm run dev`. Do **not** run `npm run build` while `npm run dev` is live (the build rewrites `dist/` and crashes the Windows dev watcher).

**Dev/preview port keeps climbing (5173→5174…)**
→ A stopped Vite process is still releasing the port. Harmless — use the port Vite prints, or kill stray `node` processes. Pin with `npm run preview -- --port 4180`.

**Canvas not rendering**
→ Check WebGL 2.0 support; verify canvas dimensions > 0.

---

**Last Updated:** 2026-07-07
**Version:** 1.6.2 (SUBO GLB calibration — largest-substrate anchoring for pins/matrix · hidden-until-needed pin reveal system for all boards · Blender + fal.ai MCP asset-authoring tooling)
