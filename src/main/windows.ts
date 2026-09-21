import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { AppState } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let dockWindow: BrowserWindow | null = null

function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = hash
      ? `${process.env.ELECTRON_RENDERER_URL}#${hash}`
      : process.env.ELECTRON_RENDERER_URL
    void win.loadURL(url)
  } else if (hash) {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  const win = new BrowserWindow({
    width: 440,
    height: 780,
    minWidth: 400,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'ARGOS TRANSFER',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('close', (event) => {
    event.preventDefault()
    win.hide()
  })

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(win)
  mainWindow = win
  return win
}

export function createDockWindow(): BrowserWindow {
  if (dockWindow && !dockWindow.isDestroyed()) {
    return dockWindow
  }

  const display = screen.getPrimaryDisplay()
  const { width, height, x, y } = display.workArea
  const dockWidth = 28
  const dockHeight = 220

  const win = new BrowserWindow({
    width: dockWidth,
    height: dockHeight,
    x: x + width - dockWidth,
    y: y + Math.round((height - dockHeight) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false)
  loadRenderer(win, 'dock')
  dockWindow = win
  return win
}

export function showMainWindow(): void {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow()
  win.show()
  win.focus()
}

export function destroyWindows(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close')
    mainWindow.close()
  }
  if (dockWindow && !dockWindow.isDestroyed()) {
    dockWindow.close()
  }
  mainWindow = null
  dockWindow = null
}

export function setDockVisible(visible: boolean): void {
  if (visible) {
    const win = createDockWindow()
    win.show()
  } else if (dockWindow && !dockWindow.isDestroyed()) {
    dockWindow.hide()
  }
}

export function broadcastState(state: AppState): void {
  for (const win of [mainWindow, dockWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('argos:state', state)
    }
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
