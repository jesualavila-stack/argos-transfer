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
  showWindow: (): Promise<void> => ipcRenderer.invoke('argos:showWindow'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('argos', api)
