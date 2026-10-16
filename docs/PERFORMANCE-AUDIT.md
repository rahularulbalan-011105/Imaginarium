# Constructa performance audit: 2026-10-13

Scope: CAD editing responsiveness, rendering cost on integrated graphics, asset handling, physics cost and honesty, and leaks over long sessions. This builds on the 1.10.0 pass (lazy chunks, on-demand meshopt GLBs, device profiles, adaptive resolution, F9 overlay). Everything below was measured unless it is marked *estimated*.

**Test machine:** i7-14650HX (24 threads), 16 GB RAM, **Intel UHD integrated GPU** (driven headless through ANGLE/D3D11; this is the real GPU, not software rendering). Chrome's DevTools CPU throttling (4×) and a 2× device pixel ratio imitate an entry-level laptop with a high-DPI screen. Every render in the frame benchmark is timed with `gl.finish()`, so the numbers include GPU time.

## A. Audit findings

### Confirmed bottlenecks (measured)

| # | Where | What | Evidence | Severity |
|---|---|---|---|---|
| 1 | `SceneManager._startLoop` | Static scenes were repainted ~8×/s (120 ms "idle floor"), including the soft-shadow pass, forever | Scene C idle: **319 ms of GPU work per second** (≈32% of the iGPU) at DPR 2 doing nothing; 78 ms/s at DPR 1 | **High** (the one cost every user pays all the time) |
| 2 | `ObjectManager.updateMesh` → `refreshOutline` + `applyHoleStyle` | Every transform update (each frame of a drag) rebuilt the selection outline (new EdgesGeometry + LineMaterial; its shader program was freed and **recompiled each frame**) and flagged every material `needsUpdate` | CPU profile of a drag (4× CPU): `getProgramInfoLog`/`shaderSource`/`onFirstUse` ≈ 6 ms/frame; three.js render CPU 11.3 ms/frame | **High** for CAD responsiveness |
| 3 | `SceneManager` | The shadow map was re-rendered on every paint, including camera-only orbits (the sun is fixed) | Scene C orbit render p50 43.6 ms (4× CPU, DPR 2) | Medium |
| 4 | `devicePerformance.QUALITY_PRESETS.low` | The **Low graphics profile silently halved the robot physics rate** (240 → 120 Hz) on any auto-detected Low device | Code; physics bench shows physics is not the low-end bottleneck (below) | High (simulation honesty) |
| 5 | `RoboticsRuntime.advance` / `DriveManager.step` | When frames are too slow, catch-up is capped (correct), but the resulting **slow motion was never shown**; `droppedTime` was tracked but unused, and `stepMsAvg` timed only `world.step` | Code | High (honesty) |
| 6 | `devicePerformance.classify` | An integrated GPU with a strong CPU/RAM was classified **High** (2× DPR cap, 2048² shadows) | Intel UHD auto-detected as `high` | Medium |
| 7 | Built-in GLBs | A few small parts are extremely dense: SUBO 166k triangles, free_wheels 146k, OLED 77k, DHT11 75k, IR 44k, buzzer 26k; one material per mesh | Scene C (42 parts) = 1.55 M triangles / 884 draw calls → ~38 ms/paint at DPR 2 on the iGPU, vertex-bound (lowering resolution doesn't fix it) | Medium. **Not changed** (see E) |
| 8 | `utmTracking.send` | Analytics fired from localhost/dev/benchmarks (writing test rows to the production Sheet); fetch fallback rejections were unhandled | ~1,600 "Failed to fetch" page errors in one benchmark run | Low (correctness / noise) |

### Investigated and NOT bottlenecks (measured, left unchanged)

- **Physics cost.** One robot at 240 Hz costs **1.0–1.3 ms per 60 fps frame**. Two quadrupeds plus two hexapods cost 4.3 ms. (`tools/bench/physics.mjs`, real Rapier.) Physics is not why low-end laptops lag, so the timestep was **not** reduced.
- **Editing vs simulation separation.** It already exists: physics only steps while a simulation is running (`App.onAnimationTick` → `driveManager.step()` only when `simActive`).
- **Idle per-frame JavaScript.** `onAnimationTick` costs 0.002–0.004 ms/frame. Bonds and joints already skip unchanged matrices.
- **React during a drag.** The dev build showed ~7.5 ms/frame of React work at 4× CPU. In a **production** build, nudging at 4× CPU / DPR 2 holds p50 16.6 ms and p95 18.5 ms with zero long tasks. `PropertiesPanel` was therefore not restructured.
- **The 38 ms "drag" in `tools/bench/runtime.cjs`** is that benchmark's own React-DevTools-hook overhead (it walks the whole fiber tree on every commit). The real update costs 0.9 ms.
- **Memory and leaks.** Scene F (5× load preset → simulate → stop → new project): geometries, textures, Rapier bodies, JS heap and rAF loops all stay flat (200 g / 17 t / 1 body / 40 MB / 4 rAF per frame).
- **Colliders.** These are primitives or convex hulls (never triangle meshes). A robot's own links never collide with each other (collision groups). Sleeping is deliberately disabled (documented in code: falling bodies, motor-driven links). No CCD is needed at 240 Hz with these speeds.
- **Startup.** Unchanged from the 1.10 pass: low-end (6× CPU, 8 Mbps) reaches the workspace in **2.1 s**, with 440 KB gz of startup JS (budget 470).

## B. Changes implemented

| Change | Files | Why | Trade-off |
|---|---|---|---|
| Idle safety-net repaint 120 ms → 1000 ms; viewport pointer/wheel input wakes the renderer; alignment-guide fade wakes it | `SceneManager.js`, `AlignmentManager.js` | Finding 1. Every scene change already wakes the renderer (store subscriptions, gizmo, orbit, model loads, simulation). The floor only covered changes that forgot to. | A change that wakes nothing would appear ≤1 s late instead of ≤120 ms (none known after the audit) |
| Shadow map re-rendered only on scene changes (`shadowMap.autoUpdate = false`; `requestRender(ms, cameraOnly)`) | `SceneManager.js` | Finding 3. Camera-only renders skip the shadow pass (verified: 0 vs 30 shadow passes per 30 frames). | Anything that moves objects must call `requestRender()` without `cameraOnly` (all existing callers do) |
| Outline rebuilt only when the geometry changes; material `needsUpdate` only when transparency/depth-write changes | `ObjectManager.js` | Finding 2. Outlines already follow transforms (`_syncOutlines`). | None |
| Graphics profiles no longer change physics. 120 Hz "Preview physics" is an explicit opt-in in Settings, labelled as less precise | `devicePerformance.js`, `SettingsPanel.jsx` | Finding 4 | Low-end CPUs keep 240 Hz unless the user opts in |
| Whole-step physics timing (control + solve + post) and per-frame simulated time | `RoboticsRuntime.js` | Finding 5 | None |
| Real-time tracking for every sim path, "🐢 Slow motion · N% of real time" badge in the sim HUD, dropped time in the Physics panel | `DriveManager.js`, `DrivePanel.jsx`, `PhysicsPanel.jsx` | Finding 5. Verified: appears at 83% under a 20× CPU slowdown, absent at normal speed. | None |
| Integrated GPUs never start on High; adaptive resolution steps down after ~15 frames when below 30 fps (was 45) | `devicePerformance.js` | Finding 6 | Slightly more conservative default visuals on iGPUs |
| F9 overlay: frame-time p50/p95, physics ms per frame, substeps, real-time %, simulation on/off + fidelity, auto vs fixed resolution; resets when opened | `PerfOverlay.jsx`, `SceneManager.js` | Diagnostics required by the spec. Samples at 2 Hz (no per-frame React). | None |
| Analytics never sends from localhost; fetch fallback rejections caught | `utmTracking.js` | Finding 8 | None |
| Opt-in `--simplify` in the model optimiser (off by default) | `tools/optimize-models.mjs` | Finding 7, left as a decision for the owner | Not applied |
| Benchmarks: `frames.cjs` (real GPU, scenes A–F), `interaction.cjs` (production UI), `physics.mjs` (Rapier) | `tools/bench/` | Phase 2 | None |
| Tests: integrated-GPU cap, profiles never change physics, fast step-down; overload cap + dropped-time reporting | `tests/perf/`, `tests/physics/overload.test.js` | Regression guards | None |

## C. Before / after

All measured on the machine above. "Low-end" = 4× CPU slowdown + DPR 2 (auto profile **medium** both before and after, pixel ratio 1.5). "Normal" = no slowdown, DPR 1 (auto profile high → medium after change 6). Dev server for `frames.cjs` (it reads app internals); production builds for `interaction.cjs`.

| Scene | Metric | Before | After | Env |
|---|---|---|---|---|
| A empty editor | idle repaints/s | 7.7 | **1.0** | normal |
| A empty editor | idle GPU ms/s | 7.4 | **1.0** | low-end |
| B CAD (60 primitives + 6 parts) | idle GPU ms/s | 53.9 | **6.5** | low-end |
| B | drag frame p50 / p95 | 27.8 / 31.4 ms | **23.2 / 27.8 ms** | low-end, dev build |
| B | drag render p95 (incl. GPU) | 11.4 ms | **9.3 ms** | low-end |
| B | orbit render p95 | 8.6 ms | **6.9 ms** | low-end |
| C 42 detailed parts | idle GPU ms/s | 319 | **48** | low-end |
| C | orbit render p50 / p95 | 43.6 / 58.0 ms | **37.8 / 50.2 ms** | low-end |
| C | orbit render p50 | 8.2 ms | **6.7 ms** | normal |
| D 4-wheel chassis (edit mode) | idle GPU ms/s | 29.8 | **4.7** | low-end |
| D single leg / robotic head | idle GPU ms/s | 13.9 / 25.3 | **3.1 / 3.1** | low-end |
| E simulation (wheeled) | frame p50 / p95 | 16.7 / 19.6 ms | 16.6 / 19.7 ms | low-end (already 60 fps) |
| E physics, 1 quadruped | ms per 60 fps frame | 1.01 ms | (unchanged code path) | Node, real Rapier |
| F 5 churn cycles | geometries / textures / bodies / heap | flat | flat | low-end |
| Production: nudge (drag path) | frame p95 | 23.0 ms | **18.5 ms** | low-end, prod build |
| Production: idle | main-thread jank over 3 s | 99–115 ms | **17 ms** | low-end, prod build |
| Startup (low profile) | workspace ready | 2.2 s (1.10 pass) | 2.1 s | 6× CPU, 8 Mbps |

GPU memory is not measurable from the browser. "Geometries/textures" are three.js's counts of live GPU resources.

## D. Compatibility

- `npm test`: **69/69 pass** (11 files), including real-Rapier legged walking, terrain, multi-robot collisions, servo/thermal/power, save/load, undo, and the 120 Hz stability test.
- `npm run build` OK. `npm run check:bundle` OK.
- Benchmark runs exercised, without errors: adding primitives and GLB parts, selection, transform updates, loading 3 presets (save/load path), simulation start/stop ×6, and new project.
- Not exercised by automation (no change touches them directly): Boolean/extrude/slice/fillet tools, wiring UI, Blockly/code editor, Google Drive/share. Battle/Arena are no longer mounted in the editor (removed in `f80a8b1`).

## E. Remaining bottlenecks

1. **Dense GLB parts (finding 7).** This is the main remaining cost in big scenes on integrated GPUs: ~38 ms/paint for 42 parts at DPR 2, and vertex-bound, so lower resolution barely helps. Measured `--simplify=0.0005` result: the six densest models go from 534k to 236k triangles (−56%). Not applied, because it visibly changes the models (SUBO is a product model). It needs a visual sign-off.
2. **One material per mesh in the GLBs** (e.g. SUBO has 34 meshes and 34 materials) → many draw calls. Merging (`gltf-transform join`) would break the node names that the rotor/horn detection, SUBO pin anchoring and LED emissive lookup rely on. It needs those lookups made name-independent first.
3. **`PropertiesPanel` re-renders on every object change** (it subscribes to the whole `objects` array). Fine in production today; worth splitting if the panel grows.
4. Wheeled/free-fall simulation uses a variable timestep (clamped to 50 ms). Slow motion is now reported, but the path isn't fixed-step like the articulated engine.

## F. Recommended next steps

| Priority | Item | Benefit | Cost | Risk |
|---|---|---|---|---|
| 1 | Review `--simplify` output visually for subo / free_wheels / oled / dht11 / buzzer; ship the ones that look identical | Large-scene GPU cost −40–55% (*estimated* from the triangle reduction; vertex-bound) | Low | Low–medium (visual) |
| 2 | Screen-size LOD for the dense parts (full mesh when selected or near) | Similar, without touching the originals | Medium | Medium (selection/outline/pins must follow) |
| 3 | Name-independent rotor/pin/LED lookup, then `join` same-material meshes | Fewer draw calls (CPU) | Medium | Medium |
| 4 | Narrow `PropertiesPanel` subscriptions to the selected object | Less React work per drag on very slow CPUs | Medium | Low |

## G. Reproduce

```bash
npm install                     # --legacy-peer-deps if peer conflicts appear
npm test                        # 69 tests (physics + perf + dashboard)
npm run build && npm run check:bundle

# physics cost (Node, real Rapier)
node tools/bench/physics.mjs

# real-GPU frame costs, scenes A–F (dev server — the bench imports app modules)
npx vite --port 5173
node tools/bench/frames.cjs http://localhost:5173/Imaginarium/ normal 1 d3d11 1
node tools/bench/frames.cjs http://localhost:5173/Imaginarium/ lowend 4 d3d11 2

# production interaction (don't run while the dev server is building dist/)
npm run build && npx vite preview --port 4180
node tools/bench/interaction.cjs http://localhost:4180/Imaginarium/ prod 4 2
node tools/bench/startup.cjs http://localhost:4180/Imaginarium/ prod

# opt-in model simplification (writes public/models — review before committing)
node tools/optimize-models.mjs --simplify=0.0005 subo free_wheels oled dht11 buzzer
```

In-app: **F9** (or Settings → Performance) opens the overlay. Settings → Performance holds the profile (Auto/Low/Medium/High), render scale, shadows, antialiasing and physics quality (Standard 240 Hz / Preview 120 Hz).
