// Electron main process — wraps the built Vite web app as a desktop window.
// CommonJS (.cjs) on purpose: package.json has "type":"module", so a .js file
// here would be treated as ESM and Electron's bootstrap expects CommonJS.
const { app, BrowserWindow, shell } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Dev: load the running Vite server (set ELECTRON_START_URL=http://localhost:5173).
  // Packaged: load the static build from dist/.
  const startUrl = process.env.ELECTRON_START_URL
  if (startUrl) {
    win.loadURL(startUrl)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Open external links (docs, OAuth, etc.) in the user's real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
