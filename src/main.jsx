import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/globals.css'
import { captureUTM } from './utils/utmTracking.js'
import { loadParts } from './parts/registry.js'

// Record how this visit arrived (?utm_source=…) before the app renders.
// Backend-free: stored in localStorage, viewable at /utm-dashboard.html.
captureUTM()

// The parts catalogue (src/parts/catalog) is its own chunk: fetch it straight
// away, in parallel with the editor booting, so it is ready by the time anyone
// opens the library. Objects of a catalogue type that load before it are
// drawn as placeholders and rebuilt when it lands (ObjectManager).
loadParts().catch((e) => console.error('[parts] catalogue failed to load', e))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
