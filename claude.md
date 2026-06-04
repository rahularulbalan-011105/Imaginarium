# 3D Design Editor (Tinkercad Clone) - Project Documentation

## Project Overview

A web-based 3D object design and manipulation tool inspired by Tinkercad. Users can create, edit, and manage 3D objects in a browser-based editor without any login or authentication. All projects are stored locally in the user's browser using IndexedDB.

**Status:** MVP (Minimum Viable Product) Planning  
**Target Users:** Hobbyists, educators, makers, 3D printing enthusiasts  
**Platform:** Web (Browser-based, responsive desktop)

---

## Technology Stack

### Frontend Architecture

```
React 18+ + Three.js + Zustand + Tailwind CSS
```

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **React** | 18.x | Component-based UI framework |
| **Three.js** | Latest | 3D rendering engine |
| **Zustand** | Latest | State management (lightweight) |
| **Tailwind CSS** | Latest | Styling and responsive design |
| **Shadcn/ui** | Latest | Pre-built UI components |
| **three-stdlib** | Latest | Extended Three.js utilities |
| **uuid** | Latest | Unique ID generation for objects |

### Optional Dependencies (Phase 2+)

- **react-three-fiber** - React renderer for Three.js (alternative approach)
- **three-mesh-bvh** - Performance optimization for large scenes
- **tinyexr** / **three-gltf-exporter** - Model export formats
- **framer-motion** - Advanced animations (UI layer)

---

## Project Structure

```
3d-design-editor/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── Viewport.jsx          # Main 3D canvas component
│   │   ├── Toolbar.jsx           # Shape creation toolbar
│   │   ├── PropertiesPanel.jsx   # Object properties editor
│   │   ├── ObjectList.jsx        # Scene hierarchy/objects list
│   │   ├── Header.jsx            # Top navigation & file controls
│   │   └── StatusBar.jsx         # Bottom status display
│   ├── stores/
│   │   ├── sceneStore.js         # Zustand scene state
│   │   └── uiStore.js            # UI state (panels, selection)
│   ├── managers/
│   │   ├── SceneManager.js       # Three.js scene initialization
│   │   ├── ObjectManager.js      # Add/remove/update 3D objects
│   │   ├── HistoryManager.js     # Undo/redo functionality
│   │   └── StorageManager.js     # IndexedDB operations
│   ├── utils/
│   │   ├── geometryFactory.js    # Create primitive shapes
│   │   ├── export.js             # Export to JSON/STL/GLTF
│   │   └── helpers.js            # Utility functions
│   ├── hooks/
│   │   ├── useScene.js           # Custom hook for scene access
│   │   ├── useSelection.js       # Selection state hook
│   │   └── useHistory.js         # Undo/redo hook
│   ├── styles/
│   │   └── globals.css           # Global Tailwind & custom CSS
│   └── App.jsx                   # Main app component
├── package.json
├── tailwind.config.js
└── README.md
```

---

## Data Models

### Scene Object Structure

```javascript
{
  id: "uuid-123",
  name: "Cube_1",
  type: "box",                    // box, sphere, cylinder, cone, etc.
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  color: "#ff6b6b",
  material: "standard",           // standard, metallic, transparent
  metadata: {
    createdAt: "2024-06-03T10:30:00Z",
    updatedAt: "2024-06-03T10:35:00Z"
  }
}
```

### Project/Scene Data Structure

```javascript
{
  projectId: "project-uuid-456",
  name: "My Design Project",
  version: "1.0",
  created: "2024-06-03T10:00:00Z",
  modified: "2024-06-03T10:35:00Z",
  camera: {
    position: { x: 0, y: 0, z: 50 },
    target: { x: 0, y: 0, z: 0 },
    zoom: 1
  },
  objects: [
    // Array of scene objects
  ],
  settings: {
    gridSize: 10,
    gridVisible: true,
    ambientLight: 0x404040,
    showAxes: true
  }
}
```

### Zustand Store Schema

```javascript
// sceneStore.js
{
  // Objects
  objects: [],
  selectedId: null,
  
  // Scene settings
  gridVisible: true,
  axesVisible: true,
  
  // Actions
  addObject: (type) => void,
  removeObject: (id) => void,
  updateObject: (id, properties) => void,
  selectObject: (id) => void,
  clearSelection: () => void,
  
  // Batch operations
  duplicateObject: (id) => void,
  deleteSelected: () => void,
  clearScene: () => void
}

// uiStore.js
{
  // UI State
  activePanel: "properties",      // properties, objects, export
  isDarkMode: false,
  sidebarCollapsed: false,
  
  // Actions
  togglePanel: (panel) => void,
  toggleDarkMode: () => void,
  setSidebarCollapsed: (value) => void
}
```

---

## Core Features (MVP)

### Phase 1: Core Functionality ✅

#### 3.1 Viewport & Rendering
- [ ] Three.js scene with WebGL renderer
- [ ] Orbit camera controls
- [ ] Grid background (toggleable)
- [ ] Coordinate axes (toggleable)
- [ ] Ambient + directional lighting
- [ ] Real-time shadow rendering
- [ ] Object selection highlighting

#### 3.2 Shape Creation & Manipulation
- [ ] Add primitives: Cube, Sphere, Cylinder, Cone, Torus, Plane
- [ ] Drag-to-create shapes in viewport
- [ ] Transform Controls (Move, Rotate, Scale)
- [ ] Keyboard shortcuts for operations
- [ ] Snap-to-grid option
- [ ] Color picker for materials
- [ ] Material types: Standard, Metallic, Transparent

#### 3.3 Scene Management
- [ ] Object list panel (tree view)
- [ ] Select/deselect objects
- [ ] Rename objects
- [ ] Duplicate objects
- [ ] Delete objects
- [ ] Group objects (optional for Phase 2)
- [ ] Show/hide objects

#### 3.4 Properties Panel
- [ ] Real-time position editing (X, Y, Z)
- [ ] Rotation control (X, Y, Z)
- [ ] Scale control (uniform & per-axis)
- [ ] Color picker
- [ ] Material properties
- [ ] Object rename
- [ ] Delete button

#### 3.5 History & Undo/Redo
- [ ] Undo last action (Ctrl+Z)
- [ ] Redo action (Ctrl+Y)
- [ ] History limit: 50 actions max
- [ ] Clear history on new project

#### 3.6 Local Storage
- [ ] Auto-save to IndexedDB (every 30 seconds)
- [ ] Save button in header
- [ ] Recent projects list
- [ ] Open project dialog
- [ ] Delete project
- [ ] Export project as JSON
- [ ] Import project from JSON

### Phase 2: Enhanced Features (Future)

- [ ] Multiple materials/textures
- [ ] Boolean operations (union, subtract, intersect)
- [ ] Object grouping/hierarchy
- [ ] Layer system
- [ ] STL/GLTF export for 3D printing
- [ ] OBJ/FBX export
- [ ] Import external 3D models
- [ ] Advanced lighting system
- [ ] Environment maps (HDRI)
- [ ] Post-processing effects

### Phase 3: Advanced Features (Future)

- [ ] Collaborative editing (WebSocket)
- [ ] User accounts & cloud sync
- [ ] Real-time preview rendering
- [ ] AR preview
- [ ] Mobile app version
- [ ] Plugin system
- [ ] Custom shape designer

---

## Setup & Installation

### Prerequisites
- Node.js 16+ and npm
- Modern browser with WebGL support (Chrome, Firefox, Edge, Safari)

### Installation Steps

```bash
# 1. Create React app
npx create-react-app 3d-design-editor
cd 3d-design-editor

# 2. Install dependencies
npm install three zustand uuid

# 3. Install UI & styling
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install @radix-ui/react-dialog @radix-ui/react-tabs

# 4. (Optional) Install advanced libraries
npm install three-stdlib

# 5. Start development server
npm start
```

### Tailwind Configuration
Update `tailwind.config.js`:
```javascript
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#3b82f6",
        secondary: "#8b5cf6"
      }
    }
  },
  plugins: []
}
```

---

## Development Workflow

### Key Concepts

#### Three.js Integration
```javascript
// SceneManager.js
class SceneManager {
  constructor(canvasElement) {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ canvas });
    this.camera = new THREE.PerspectiveCamera(75, width/height, 0.1, 10000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
  }
  
  addCube(position, size, color) {
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);
    return mesh;
  }
  
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
```

#### Zustand Store Pattern
```javascript
// sceneStore.js
import create from 'zustand';

export const useSceneStore = create((set) => ({
  objects: [],
  selectedId: null,
  
  addObject: (object) => set((state) => ({
    objects: [...state.objects, object]
  })),
  
  updateObject: (id, updates) => set((state) => ({
    objects: state.objects.map(obj => 
      obj.id === id ? { ...obj, ...updates } : obj
    )
  }))
}));
```

#### Component Structure
```javascript
// App.jsx
function App() {
  return (
    <div className="flex h-screen bg-gray-900 text-white">
      <Header />
      <div className="flex flex-1">
        <Toolbar />
        <Viewport />
        <PropertiesPanel />
      </div>
      <StatusBar />
    </div>
  );
}
```

---

## API Reference

### SceneManager Methods

```javascript
// Add objects
addBox(position, size, color) -> Object3D
addSphere(position, radius, color) -> Object3D
addCylinder(position, radius, height, color) -> Object3D
addCone(position, radius, height, color) -> Object3D
addTorus(position, radius, tubeRadius, color) -> Object3D
addPlane(position, width, height, color) -> Object3D

// Modify objects
updatePosition(objectId, x, y, z) -> void
updateRotation(objectId, x, y, z) -> void
updateScale(objectId, x, y, z) -> void
updateColor(objectId, color) -> void
updateMaterial(objectId, materialType) -> void

// Scene operations
removeObject(objectId) -> void
selectObject(objectId) -> void
duplicateObject(objectId) -> Object3D
clearScene() -> void
getObject(objectId) -> Object3D
getAllObjects() -> Object3D[]

// Camera
setCamera(position, target, zoom) -> void
resetCamera() -> void
fitToView() -> void

// Rendering
render() -> void
```

### StorageManager Methods

```javascript
// Projects
saveProject(projectData) -> Promise<string>
loadProject(projectId) -> Promise<Object>
deleteProject(projectId) -> Promise<void>
getAllProjects() -> Promise<Array>
exportProjectJSON(projectId) -> Promise<string>
importProjectJSON(jsonString) -> Promise<void>

// Auto-save
enableAutoSave(intervalMs) -> void
disableAutoSave() -> void
```

### HistoryManager Methods

```javascript
// Undo/Redo
undo() -> void
redo() -> void
canUndo() -> boolean
canRedo() -> boolean
clearHistory() -> void
addToHistory(action) -> void
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` / `Cmd+Y` | Redo |
| `Ctrl+D` | Duplicate selected |
| `Delete` | Delete selected |
| `G` | Toggle grid |
| `A` | Toggle axes |
| `L` | Toggle lighting |
| `F` | Frame/fit selection |
| `1` | Add cube |
| `2` | Add sphere |
| `3` | Add cylinder |
| `4` | Add cone |
| `5` | Add torus |
| `Escape` | Deselect all |
| `Mouse Wheel` | Zoom camera |
| `Middle Mouse Drag` | Rotate camera |
| `Right Mouse Drag` | Pan camera |

---

## File Format Specifications

### Internal Format (IndexedDB)
```json
{
  "projectId": "uuid",
  "name": "Project Name",
  "version": "1.0",
  "created": "ISO8601",
  "modified": "ISO8601",
  "camera": {
    "position": { "x": 0, "y": 0, "z": 50 },
    "target": { "x": 0, "y": 0, "z": 0 },
    "zoom": 1
  },
  "objects": [
    {
      "id": "uuid",
      "name": "Object Name",
      "type": "box|sphere|cylinder|cone|torus|plane",
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 },
      "color": "#ff6b6b",
      "material": "standard|metallic|transparent",
      "visible": true,
      "metadata": {
        "createdAt": "ISO8601",
        "updatedAt": "ISO8601"
      }
    }
  ],
  "settings": {
    "gridSize": 10,
    "gridVisible": true,
    "axesVisible": true,
    "ambientLight": 16711680
  }
}
```

### Export Formats (Phase 2)

**JSON Export**
```json
// Same as internal format
```

**STL Export**
- Binary STL format for 3D printing
- Combines all objects into single mesh

**GLTF/GLB Export**
- Modern 3D format with full material support
- Preserves colors, materials, textures

---

## Performance Considerations

### Optimization Tips

1. **Scene Optimization**
   - Limit objects in scene (target: <5000 for smooth 60fps)
   - Use instancing for repeated objects (Phase 2)
   - Frustum culling for off-screen objects

2. **Rendering**
   - Enable shadows selectively
   - Use WebGL context optimization
   - Implement LOD (Level of Detail) for complex meshes

3. **Memory Management**
   - Dispose geometries/materials on delete
   - Limit history stack to 50 actions
   - Compress IndexedDB data

4. **Storage**
   - Max project size: ~10MB (IndexedDB limit per origin)
   - Auto-compress on export
   - Clean up old projects periodically

---

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | ✅ Full | Recommended |
| Firefox | ✅ Full | Full WebGL support |
| Safari | ✅ Full | macOS 10.11+ |
| Edge | ✅ Full | Chromium-based |
| IE 11 | ❌ None | No WebGL |

**Requirements:**
- WebGL 1.0 or 2.0 support
- ES6+ JavaScript support
- IndexedDB support

---

## Deployment

### Build for Production

```bash
npm run build
```

### Hosting Options

1. **Vercel** (Recommended)
   ```bash
   npm i -g vercel
   vercel
   ```

2. **Netlify**
   ```bash
   netlify deploy --prod --dir=build
   ```

3. **GitHub Pages**
   - Add to package.json: `"homepage": "https://username.github.io/3d-design-editor"`
   - Deploy with gh-pages package

4. **Self-hosted**
   - Upload `build/` folder to web server
   - Serve as static site
   - No backend required

---

## Development Roadmap

### V1.0 (MVP) - Current
- [x] Project initialization
- [ ] Core 3D viewport
- [ ] Basic shape creation
- [ ] Transform controls
- [ ] Properties panel
- [ ] Local storage
- [ ] Undo/redo

**Estimated:** 3-4 weeks

### V1.5 (Polish)
- [ ] Enhanced UI/UX
- [ ] More shape types
- [ ] Material editor
- [ ] Performance optimizations
- [ ] Mobile responsiveness

**Estimated:** 2 weeks

### V2.0 (Advanced)
- [ ] Boolean operations
- [ ] Model import/export (STL, GLTF, OBJ)
- [ ] Grouping & layers
- [ ] Advanced lighting
- [ ] Textures & normal maps

**Estimated:** 6-8 weeks

### V2.5 (Cloud)
- [ ] User authentication
- [ ] Cloud synchronization
- [ ] Collaborative editing
- [ ] Project sharing

**Estimated:** 8-10 weeks

---

## Testing Strategy

### Unit Tests
```javascript
// __tests__/managers/SceneManager.test.js
import { SceneManager } from '../../managers/SceneManager';

describe('SceneManager', () => {
  let manager;
  
  beforeEach(() => {
    const canvas = document.createElement('canvas');
    manager = new SceneManager(canvas);
  });
  
  test('should add cube to scene', () => {
    const cube = manager.addBox({ x: 0, y: 0, z: 0 }, 1, '#ff0000');
    expect(manager.scene.children).toContain(cube);
  });
  
  test('should update object position', () => {
    const obj = manager.addBox({ x: 0, y: 0, z: 0 }, 1, '#ff0000');
    manager.updatePosition(obj.uuid, 10, 20, 30);
    expect(obj.position).toEqual({ x: 10, y: 20, z: 30 });
  });
});
```

### Integration Tests
- Test store updates trigger scene changes
- Test undo/redo functionality
- Test storage persistence

### E2E Tests
- Create project → Add shapes → Save → Reload
- Transform objects → Verify positions update
- Export/import projects

---

## Troubleshooting

### Common Issues

**Canvas not rendering**
- Check WebGL support: `gl.RENDERER` in browser console
- Verify Three.js is loaded
- Check canvas size is > 0

**Performance issues**
- Reduce object count
- Disable shadows temporarily
- Check for memory leaks in DevTools

**Storage not persisting**
- Verify IndexedDB is enabled
- Check browser's storage quota
- Clear conflicting data

**Objects disappearing**
- Check object visibility flag
- Verify camera position/clipping planes
- Check lighting conditions

---

## Resources & References

### Documentation
- [Three.js Docs](https://threejs.org/docs)
- [Zustand Guide](https://github.com/pmndrs/zustand)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [MDN WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

### Similar Projects for Inspiration
- [Tinkercad](https://www.tinkercad.com) - Original
- [Three.js Examples](https://threejs.org/examples)
- [Babylon.js Playground](https://www.babylonjs-playground.com)
- [p5.js Web Editor](https://editor.p5js.org)

### Community
- [Three.js Discord](https://discord.com/invite/HF5gJ7XjYj)
- [Stack Overflow Tag: three.js](https://stackoverflow.com/questions/tagged/three.js)
- [Reddit: r/threejs](https://reddit.com/r/threejs)

---

## Contributors Guide

### Setting Up Development Environment

```bash
# Clone & setup
git clone <repo>
cd 3d-design-editor
npm install

# Create feature branch
git checkout -b feature/your-feature

# Make changes and test
npm start

# Run tests
npm test

# Submit PR
git push origin feature/your-feature
```

### Code Style
- Use ES6+ features
- Follow React hooks patterns
- Comment complex logic
- Use TypeScript for type safety (Phase 2)

---

## License

MIT License - Free for educational and commercial use

---

## Contact & Support

**Project Lead:** [Your Name]  
**Email:** [your.email@example.com]  
**Issues:** [GitHub Issues Link]  
**Discussions:** [GitHub Discussions Link]

---

## Changelog

### Version 1.0.0 (Initial)
- Project initialization and planning
- Tech stack finalization
- Component architecture design
- Data model specification

---

**Last Updated:** June 3, 2024  
**Version:** 1.0.0-planning