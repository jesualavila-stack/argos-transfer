import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppState, PeerInfo } from '../shared/types'

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('argos:getState'),
  onState: (callback: (state: AppState) => void): (() => void) => {
    const listener = (_event: unknown, state: AppState): void => callback(state)
    ipcRenderer.on('argos:state', listener)
    return () => {
      ipcRenderer.removeListener('argos:state', listener)
    }
  },
  setName: (name: string): Promise<void> => ipcRenderer.invoke('argos:setName', name),
  setPin: (pin: string): Promise<void> => ipcRenderer.invoke('argos:setPin', pin),
  regeneratePin: (): Promise<string> => ipcRenderer.invoke('argos:regeneratePin'),
  setReceiveDir: (): Promise<string | null> => ipcRenderer.invoke('argos:setReceiveDir'),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('argos:pickFiles'),
  sendFiles: (peerId: string | undefined, paths: string[]): Promise<void> =>
    ipcRenderer.invoke('argos:sendFiles', peerId, paths),
  connectManual: (host: string, port?: number): Promise<PeerInfo> =>
    ipcRenderer.invoke('argos:connectManual', host, port),
  installSendTo: (label: string): Promise<{ ok: boolean; path?: string; message?: string }> =>
    ipcRenderer.invoke('argos:installSendTo', label),
  removeSendTo: (label: string): Promise<void> => ipcRenderer.invoke('argos:removeSendTo', label),
  toggleDock: (enabled: boolean): Promise<void> => ipcRenderer.invoke('argos:toggleDock', enabled),
  setSendOnly: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('argos:setSendOnly', enabled),
  showWindow: (): Promise<void> => ipcRenderer.invoke('argos:showWindow'),
  sendLiveNote: (payload: string | { text?: string; image?: string }): Promise<void> =>
    ipcRenderer.invoke('argos:sendLiveNote', payload),
  clearLiveNotes: (): Promise<void> => ipcRenderer.invoke('argos:clearLiveNotes'),
  clipboardWrite: (text: string): Promise<void> => ipcRenderer.invoke('argos:clipboardWrite', text),
  clipboardWriteImage: (dataUrl: string): Promise<void> =>
    ipcRenderer.invoke('argos:clipboardWriteImage', dataUrl),
  clipboardRead: (): Promise<string> => ipcRenderer.invoke('argos:clipboardRead'),
  clipboardReadImage: (): Promise<string | null> => ipcRenderer.invoke('argos:clipboardReadImage'),
  compressImage: (dataUrl: string): Promise<string | null> =>
    ipcRenderer.invoke('argos:compressImage', dataUrl),
  refreshInbox: (): Promise<unknown> => ipcRenderer.invoke('argos:refreshInbox'),
  openInboxItem: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('argos:openInboxItem', filePath),
  revealInboxItem: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('argos:revealInboxItem', filePath),
  openReceiveDir: (): Promise<void> => ipcRenderer.invoke('argos:openReceiveDir'),
  startDrag: (filePath: string): void => {
    ipcRenderer.send('argos:startDrag', filePath)
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('argos', api)
