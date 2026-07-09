import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/globals.css'
import { captureUTM } from './utils/utmTracking.js'

// Record how this visit arrived (?utm_source=…) before the app renders.
// Backend-free: stored in localStorage, viewable at /utm-dashboard.html.
captureUTM()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
