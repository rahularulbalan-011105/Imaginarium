import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/globals.css'
import { captureUTM } from './utils/utmTracking.js'
import { installStaleBuildWatch } from './utils/staleBuild.js'

// Record how this visit arrived (?utm_source=…) before the app renders.
// Backend-free: stored in localStorage, viewable at /utm-dashboard.html.
captureUTM()

// A tab left open across a deploy asks for chunk files that no longer exist.
// Catch those 404s globally so they surface as "reload", not as a fake crash.
installStaleBuildWatch()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
