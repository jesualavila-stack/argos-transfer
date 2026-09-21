import { app, clipboard, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID } from '../shared/constants'
import type { AppState } from '../shared/types'
import { parseSendArgs } from './argv'
import { newDeviceId, loadOrCreateTls, newPin, suggestDeviceName } from './identity'
import { loadConfig, getDataDir } from './store'
import { installSendTo, isSendToInstalled, removeSendTo } from './sendTo'
import { TransferEngine } from './transfer/engine'
import {
  broadcastState,
  createMainWindow,
  destroyWindows,
  setDockVisible,
  showMainWindow
} from './windows'

let engine: TransferEngine | null = null

const pendingSend = parseSendArgs(process.argv)
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  void boot()
}

async function boot(): Promise<void> {
  app.on('second-instance', (_event, argv) => {
    const files = parseSendArgs(argv)
    showMainWindow()
    if (files.length > 0 && engine) {
      void engine.send(files).catch(() => showMainWindow())
    }
  })

  await app.whenReady()

  electronApp.setAppUserModelId(APP_ID)
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const tls = loadOrCreateTls()
  const downloads = app.getPath('downloads')
  const config = loadConfig({
    deviceId: newDeviceId(),
    deviceName: suggestDeviceName(),
    receiveDir: join(downloads, 'Argos Transfer')
  })

  const running = new TransferEngine(config, tls)
  engine = running
  running.setPackaged(app.isPackaged)
  running.setSendToInstalled(isSendToInstalled(guessSendToLabel(running.getState())))

  running.on('state', (state: AppState) => {
    broadcastState(state)
  })

  registerIpc(running)
  await running.start()

  createMainWindow()
  setDockVisible(config.dockEnabled)
  createTray(running)

  if (pendingSend.length > 0) {
    void running.send(pendingSend).catch(() => showMainWindow())
  }

  app.on('activate', () => {
    showMainWindow()
  })
}

function guessSendToLabel(state: AppState): string {
  return state.peers[0]?.name || 'PC Casa'
}

function registerIpc(engine: TransferEngine): void {
  ipcMain.handle('argos:getState', () => engine.getState())
  ipcMain.handle('argos:setName', (_event, name: string) => {
    engine.setName(name)
  })
  ipcMain.handle('argos:setPin', (_event, pin: string) => {
    engine.setPin(pin)
  })
  ipcMain.handle('argos:regeneratePin', () => {
    const pin = newPin()
    engine.setPin(pin)
    return pin
  })
  ipcMain.handle('argos:setReceiveDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Carpeta de llegada',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    engine.setReceiveDir(result.filePaths[0])
    return result.filePaths[0]
  })
  ipcMain.handle('argos:pickFiles', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elegir archivos para enviar',
      properties: ['openFile', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('argos:sendFiles', async (_event, peerId: string | undefined, paths: string[]) => {
    await engine.send(paths, peerId)
  })
  ipcMain.handle('argos:connectManual', (_event, host: string, port?: number) => {
    return engine.connectManual(host, port)
  })
  ipcMain.handle('argos:installSendTo', (_event, label: string) => {
    const result = installSendTo(label || 'PC Casa')
    engine.setSendToInstalled(result.ok || isSendToInstalled(label))
    return result
  })
  ipcMain.handle('argos:removeSendTo', (_event, label: string) => {
    removeSendTo(label || 'PC Casa')
    engine.setSendToInstalled(false)
  })
  ipcMain.handle('argos:toggleDock', (_event, enabled: boolean) => {
    engine.setDockEnabled(enabled)
    setDockVisible(enabled)
  })
  ipcMain.handle('argos:setSendOnly', async (_event, enabled: boolean) => {
    await engine.setSendOnly(enabled)
  })
  ipcMain.handle('argos:showWindow', () => {
    showMainWindow()
  })
  ipcMain.handle('argos:dataDir', () => getDataDir())
  ipcMain.handle('argos:sendLiveNote', async (_event, text: string) => {
    await engine.sendLiveNote(text)
  })
  ipcMain.handle('argos:clearLiveNotes', async () => {
    await engine.clearLiveNotes()
  })
  ipcMain.handle('argos:clipboardWrite', (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle('argos:clipboardRead', () => clipboard.readText())
}

function createTray(engine: TransferEngine): void {
  const image = nativeImage.createFromDataURL(trayPng())
  const tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('ARGOS TRANSFER')
  const menu = Menu.buildFromTemplate([
    {
      label: 'Mostrar ARGOS TRANSFER',
      click: () => showMainWindow()
    },
    {
      label: 'Zona de lanzamiento',
      type: 'checkbox',
      checked: engine.getConfig().dockEnabled,
      click: (item) => {
        engine.setDockEnabled(item.checked)
        setDockVisible(item.checked)
      }
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        engine.stop()
        destroyWindows()
        app.exit(0)
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => showMainWindow())
}

function trayPng(): string {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAM1BMVEUAAAD///////////////////////////////////////////////////////////////////+3leKCAAAAEHRSTlMAECAwQFBgcICPn6+/z9/vIxqRsAAAAIFJREFUeNqtkkEKwzAMBM1K8tr9/9cWQihN3OaQHgSLtIxlrSVJkiRJkiT9F7z3XkQEERExMzMzMzP/gIiImZtlZ2Z2Z2Z2Z2Z2Z2b2z8zMzMzMzMz8AyIiZmaWnZnZnZnZnZnZnZnZPzMzMzMzMzPzD4iImJlZdmZmd2dmdmdmdmdm9s/MzMzMzMzM/AMiImZmlp2Z2Z2Z2Z2Z2Z2Z2T8zMzMzMzMz8w+oKgX+Aep3GgAAAABJRU5ErkJggg=='
}
