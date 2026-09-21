export type FileMeta = {
  name: string
  relativePath: string
  size: number
}

export type HelloPacket = {
  magic: 'ARGOS'
  v: 1
  type: 'hello'
  id: string
  name: string
  port: number
  fingerprint: string
}

export type LiveNoteKind = 'text' | 'image'

export type LiveNote = {
  id: string
  kind: LiveNoteKind
  text: string
  image?: string
  fromId: string
  fromName: string
  at: number
}

export type ControlMessage =
  | { type: 'auth'; id: string; name: string; pin: string }
  | { type: 'auth-ok'; id: string; name: string; fingerprint: string }
  | { type: 'auth-fail'; reason: string }
  | { type: 'offer'; files: FileMeta[] }
  | { type: 'accept' }
  | { type: 'reject'; reason: string }
  | { type: 'file-begin'; name: string; relativePath: string; size: number }
  | { type: 'file-end' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'live-open' }
  | { type: 'live-ok' }
  | { type: 'live-ping' }
  | { type: 'live-pong' }
  | {
      type: 'live-note'
      id: string
      kind?: LiveNoteKind
      text: string
      image?: string
      fromId: string
      fromName: string
      at: number
    }
  | { type: 'live-sync'; notes: LiveNote[] }
  | { type: 'live-clear' }

export type PeerInfo = {
  id: string
  name: string
  host: string
  port: number
  fingerprint: string
  lastSeen: number
  trusted: boolean
  linked: boolean
}

export type TransferSnapshot = {
  direction: 'send' | 'receive'
  peerName: string
  fileName: string
  transferred: number
  total: number
  bytesPerSec: number
} | null

export type AppState = {
  me: {
    id: string
    name: string
    pin: string
    port: number
    fingerprint: string
  }
  peers: PeerInfo[]
  receiveDir: string
  transfer: TransferSnapshot
  dockEnabled: boolean
  sendToInstalled: boolean
  packaged: boolean
  queuedCount: number
  lastError: string | null
  statusText: string
  sendOnly: boolean
  liveNotes: LiveNote[]
  liveConnected: boolean
}

export type TrustedPeer = {
  id: string
  name: string
  fingerprint: string
  lastHost?: string
  lastPort?: number
}
