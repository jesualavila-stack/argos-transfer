import type { AppState, PeerInfo } from '../shared/types'

type ArgosApi = {
  getState: () => Promise<AppState>
  onState: (callback: (state: AppState) => void) => () => void
  setName: (name: string) => Promise<void>
  setPin: (pin: string) => Promise<void>
  regeneratePin: () => Promise<string>
  setReceiveDir: () => Promise<string | null>
  pickFiles: () => Promise<string[]>
  sendFiles: (peerId: string | undefined, paths: string[]) => Promise<void>
  connectManual: (host: string, port?: number) => Promise<PeerInfo>
  installSendTo: (label: string) => Promise<{ ok: boolean; path?: string; message?: string }>
  removeSendTo: (label: string) => Promise<void>
  toggleDock: (enabled: boolean) => Promise<void>
  setSendOnly: (enabled: boolean) => Promise<void>
  showWindow: () => Promise<void>
  sendLiveNote: (payload: string | { text?: string; image?: string }) => Promise<void>
  clearLiveNotes: () => Promise<void>
  clipboardWrite: (text: string) => Promise<void>
  clipboardWriteImage: (dataUrl: string) => Promise<void>
  clipboardRead: () => Promise<string>
  clipboardReadImage: () => Promise<string | null>
  compressImage: (dataUrl: string) => Promise<string | null>
  getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    argos: ArgosApi
  }
}

export {}
