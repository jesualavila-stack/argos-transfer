import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import type { TLSSocket } from 'node:tls'
import type {
  AppState,
  ControlMessage,
  LiveNote,
  PeerInfo,
  TransferSnapshot
} from '../../shared/types'
import type { AppConfig } from '../store'
import { loadLiveNotes, saveConfig, saveLiveNotes } from '../store'
import type { TlsMaterial } from '../identity'
import { Discovery } from './discovery'
import { TransferServer } from './server'
import { openLiveChannel, pairWithPeer, sendFilesToPeer } from './client'
import { collectFiles } from './files'
import {
  createLiveImageNote,
  createLiveNote,
  LiveLink,
  mergeNotes,
  normalizeLiveNote
} from './live'
import type { Session } from './framing'

const LINK_RETRY_MS = 5000

export class TransferEngine extends EventEmitter {
  private readonly discovery: Discovery
  private readonly server: TransferServer
  private transfer: TransferSnapshot = null
  private lastError: string | null = null
  private queued: string[] = []
  private sendToInstalled = false
  private packaged = false
  private statusText = 'Buscando dispositivos en la LAN…'
  private listening = false
  private linkTimer: NodeJS.Timeout | null = null
  private linking = false
  private liveConnecting = false
  private readonly liveLinks = new Set<LiveLink>()
  private liveNotes: LiveNote[] = []

  constructor(
    private config: AppConfig,
    private readonly tls: TlsMaterial
  ) {
    super()
    this.discovery = new Discovery({
      id: config.deviceId,
      name: config.deviceName,
      port: config.tcpPort,
      fingerprint: tls.fingerprint
    })
    this.server = new TransferServer(tls, {
      id: config.deviceId,
      name: config.deviceName,
      pin: config.pin,
      receiveDir: config.receiveDir,
      fingerprint: tls.fingerprint
    })

    this.discovery.on('peers', () => this.emitState())
    this.server.on('progress', (snapshot: TransferSnapshot) => {
      this.transfer = snapshot
      this.statusText = 'Recibiendo…'
      this.emitState()
    })
    this.server.on('complete', () => {
      this.transfer = null
      this.statusText = 'Archivo recibido'
      this.emitState()
    })
    this.server.on('error', (error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.transfer = null
      this.emitState()
    })
    this.server.on(
      'live',
      (payload: { session: Session; socket: TLSSocket; peerName: string; peerId: string }) => {
        this.attachLive(payload.session, payload.socket)
      }
    )
  }

  setPackaged(value: boolean): void {
    this.packaged = value
  }

  setSendToInstalled(value: boolean): void {
    this.sendToInstalled = value
    this.emitState()
  }

  async start(): Promise<void> {
    mkdirSync(this.config.receiveDir, { recursive: true })
    this.liveNotes = loadLiveNotes()
    this.discovery.setTrusted(this.config.trustedPeers)
    this.restoreKnownHosts()
    if (this.config.sendOnly) {
      const host = this.getDefaultHost()
      this.statusText = host
        ? `Vinculando a PC Casa (${host})…`
        : 'Solo enviar · sin abrir puertos. Conectá por IP.'
      this.emitState()
      saveConfig(this.config)
      this.armLinkRetry()
      await this.linkDefaultPeer()
      await this.ensureLiveChannel()
      return
    }
    await this.startListening()
    this.armLinkRetry()
    await this.linkDefaultPeer()
    await this.ensureLiveChannel()
  }

  async setSendOnly(enabled: boolean): Promise<void> {
    this.config.sendOnly = enabled
    saveConfig(this.config)
    if (enabled) {
      this.discovery.stop()
      this.server.stop()
      this.listening = false
      this.restoreKnownHosts()
      const host = this.getDefaultHost()
      this.statusText = host
        ? `Vinculando a PC Casa (${host})…`
        : 'Solo enviar · sin abrir puertos. Conectá por IP.'
      this.emitState()
      this.armLinkRetry()
      await this.linkDefaultPeer()
      await this.ensureLiveChannel()
      return
    }
    await this.startListening()
    await this.ensureLiveChannel()
  }

  stop(): void {
    if (this.linkTimer) clearInterval(this.linkTimer)
    this.linkTimer = null
    for (const link of this.liveLinks) link.close()
    this.liveLinks.clear()
    this.discovery.stop()
    this.server.stop()
    this.listening = false
  }

  getState(): AppState {
    return {
      me: {
        id: this.config.deviceId,
        name: this.config.deviceName,
        pin: this.config.pin,
        port: this.config.tcpPort,
        fingerprint: this.tls.fingerprint.slice(0, 16)
      },
      peers: this.discovery.list(),
      receiveDir: this.config.receiveDir,
      transfer: this.transfer,
      dockEnabled: this.config.dockEnabled,
      sendToInstalled: this.sendToInstalled,
      packaged: this.packaged,
      queuedCount: this.queued.length,
      lastError: this.lastError,
      statusText: this.statusText,
      sendOnly: this.config.sendOnly,
      liveNotes: this.liveNotes,
      liveConnected: this.isLiveConnected()
    }
  }

  getConfig(): AppConfig {
    return this.config
  }

  setName(name: string): void {
    this.config.deviceName = name.trim() || this.config.deviceName
    this.syncIdentity()
    saveConfig(this.config)
    this.emitState()
  }

  setPin(pin: string): void {
    const clean = pin.replace(/\D/g, '').slice(0, 6)
    if (clean.length === 6) {
      this.config.pin = clean
      this.syncIdentity()
      saveConfig(this.config)
      this.emitState()
    }
  }

  setReceiveDir(dir: string): void {
    this.config.receiveDir = dir
    mkdirSync(dir, { recursive: true })
    this.syncIdentity()
    saveConfig(this.config)
    this.emitState()
  }

  setDockEnabled(enabled: boolean): void {
    this.config.dockEnabled = enabled
    saveConfig(this.config)
    this.emitState()
  }

  queue(paths: string[]): void {
    this.queued = [...this.queued, ...paths]
    this.emitState()
  }

  clearQueue(): void {
    this.queued = []
    this.emitState()
  }

  async connectManual(host: string, port?: number): Promise<PeerInfo> {
    const clean = host.trim()
    const tcpPort = port || this.config.tcpPort
    const peer = this.discovery.rememberManual(clean, tcpPort, 'PC Casa')
    this.discovery.markLinked(peer.id, false)
    this.config.lastPeerId = peer.id
    this.config.lastManualHost = clean
    saveConfig(this.config)
    this.armLinkRetry()
    await this.linkDefaultPeer()
    await this.ensureLiveChannel()
    return this.discovery.get(peer.id) || peer
  }

  async sendLiveNote(payload: string | { text?: string; image?: string }): Promise<void> {
    const input = typeof payload === 'string' ? { text: payload } : payload
    const note = input.image
      ? createLiveImageNote(input.image, this.config.deviceId, this.config.deviceName, input.text)
      : createLiveNote(input.text || '', this.config.deviceId, this.config.deviceName)
    if (!note) throw new Error('Pegá texto o una captura para compartir')
    if (!this.isLiveConnected()) {
      await this.ensureLiveChannel()
    }
    if (!this.isLiveConnected()) {
      throw new Error('Pizarra desconectada. Conectá a la PC Casa primero.')
    }
    this.addNote(note)
    await this.broadcast({
      type: 'live-note',
      id: note.id,
      kind: note.kind,
      text: note.text,
      image: note.image,
      fromId: note.fromId,
      fromName: note.fromName,
      at: note.at
    })
  }

  async clearLiveNotes(): Promise<void> {
    this.liveNotes = []
    saveLiveNotes(this.liveNotes)
    this.emitState()
    if (this.isLiveConnected()) {
      await this.broadcast({ type: 'live-clear' })
    }
  }

  async send(paths?: string[], peerId?: string): Promise<void> {
    const selected = paths && paths.length > 0 ? paths : this.queued
    if (selected.length === 0) {
      throw new Error('No hay archivos para enviar')
    }
    const peer = this.resolvePeer(peerId)
    if (!peer) {
      this.queued = selected
      this.statusText = 'Elegí un destino o conectá por IP'
      this.emitState()
      throw new Error('No hay un dispositivo destino')
    }

    const { files, abs } = await collectFiles(selected)
    if (files.length === 0) {
      throw new Error('No se encontraron archivos')
    }

    this.lastError = null
    this.statusText = `Enviando a ${peer.name}…`
    this.emitState()

    try {
      await sendFilesToPeer({
        host: peer.host,
        port: peer.port,
        peerName: peer.name,
        identity: {
          id: this.config.deviceId,
          name: this.config.deviceName,
          pin: this.config.pin,
          fingerprint: this.tls.fingerprint
        },
        files,
        absPaths: abs,
        onProgress: (snapshot) => {
          this.transfer = snapshot
          this.emitState()
        }
      })
      this.trustPeer(peer)
      this.queued = []
      this.transfer = null
      this.statusText = `Enviado a ${peer.name}`
      this.emitState()
    } catch (error) {
      this.transfer = null
      this.lastError = error instanceof Error ? error.message : String(error)
      this.statusText = 'No se pudo enviar'
      this.discovery.markLinked(peer.id, false)
      this.emitState()
      throw error
    }
  }

  private async startListening(): Promise<void> {
    if (this.listening) return
    const port = await this.server.start(this.config.tcpPort)
    this.config.tcpPort = port
    this.discovery.setIdentity({
      id: this.config.deviceId,
      name: this.config.deviceName,
      port,
      fingerprint: this.tls.fingerprint
    })
    this.discovery.start()
    this.listening = true
    this.statusText = 'En la misma red · esperando un par'
    this.emitState()
    saveConfig(this.config)
  }

  private restoreKnownHosts(): void {
    const host = this.getDefaultHost()
    if (host) {
      this.config.lastManualHost = host
      const peer = this.discovery.rememberManual(host, this.config.tcpPort, 'PC Casa')
      this.config.lastPeerId = peer.id
    }
    for (const trusted of this.config.trustedPeers) {
      if (trusted.lastHost) {
        this.discovery.rememberManual(
          trusted.lastHost,
          trusted.lastPort || this.config.tcpPort,
          trusted.name || 'PC Casa'
        )
      }
    }
  }

  private getDefaultHost(): string | null {
    return (
      this.config.lastManualHost ||
      this.config.trustedPeers.find((peer) => peer.lastHost)?.lastHost ||
      null
    )
  }

  private armLinkRetry(): void {
    if (this.linkTimer) return
    this.linkTimer = setInterval(() => {
      const host = this.getDefaultHost()
      if (!host) return
      const peer = this.discovery.get(`manual:${host}:${this.config.tcpPort}`)
      if (!peer?.linked) {
        void this.linkDefaultPeer()
        return
      }
      if (!this.isLiveConnected()) void this.ensureLiveChannel()
    }, LINK_RETRY_MS)
  }

  private async linkDefaultPeer(): Promise<void> {
    const host = this.getDefaultHost()
    if (!host || this.linking) return
    const port = this.config.tcpPort
    const peer = this.discovery.rememberManual(host, port, 'PC Casa')
    this.linking = true
    this.statusText = `Vinculando a ${peer.name} (${host})…`
    this.emitState()
    try {
      const remote = await pairWithPeer({
        host,
        port,
        identity: {
          id: this.config.deviceId,
          name: this.config.deviceName,
          pin: this.config.pin,
          fingerprint: this.tls.fingerprint
        }
      })
      this.discovery.markLinked(peer.id, true, {
        name: remote.name || 'PC Casa',
        fingerprint: remote.fingerprint
      })
      this.config.lastPeerId = peer.id
      this.config.lastManualHost = host
      const trustedName = remote.name || 'PC Casa'
      const existing = this.config.trustedPeers.filter(
        (item) => item.id !== peer.id && item.lastHost !== host
      )
      existing.push({
        id: peer.id,
        name: trustedName,
        fingerprint: remote.fingerprint,
        lastHost: host,
        lastPort: port
      })
      this.config.trustedPeers = existing
      this.discovery.setTrusted(existing)
      saveConfig(this.config)
      this.lastError = null
      this.statusText = `${trustedName} · Conectada`
      this.emitState()
      await this.ensureLiveChannel()
    } catch (error) {
      this.discovery.markLinked(peer.id, false)
      this.lastError = error instanceof Error ? error.message : String(error)
      this.statusText = `Sin conexión con PC Casa (${host})`
      this.emitState()
    } finally {
      this.linking = false
    }
  }

  private isLiveConnected(): boolean {
    return [...this.liveLinks].some((link) => link.open)
  }

  private identity(): { id: string; name: string; pin: string; fingerprint: string } {
    return {
      id: this.config.deviceId,
      name: this.config.deviceName,
      pin: this.config.pin,
      fingerprint: this.tls.fingerprint
    }
  }

  private async ensureLiveChannel(): Promise<void> {
    if (this.isLiveConnected() || this.liveConnecting) return
    const peer = this.resolvePeer()
    if (!peer) return
    this.liveConnecting = true
    try {
      const channel = await openLiveChannel({
        host: peer.host,
        port: peer.port,
        identity: this.identity()
      })
      this.attachLive(channel.session, channel.socket)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('pizarra en vivo')) {
        this.lastError = message
        this.emitState()
      }
    } finally {
      this.liveConnecting = false
    }
  }

  private attachLive(session: Session, socket: TLSSocket): void {
    const link = new LiveLink(
      session,
      socket,
      (msg) => this.handleLiveMessage(msg),
      () => {
        this.liveLinks.delete(link)
        this.emitState()
      }
    )
    this.liveLinks.add(link)
    this.lastError = null
    void link.send({ type: 'live-sync', notes: this.liveNotes }).catch(() => link.close())
    this.emitState()
  }

  private handleLiveMessage(msg: ControlMessage): void {
    if (msg.type === 'live-note') {
      const note = normalizeLiveNote({
        id: msg.id,
        kind: msg.kind,
        text: msg.text,
        image: msg.image,
        fromId: msg.fromId,
        fromName: msg.fromName,
        at: msg.at
      })
      if (note) this.addNote(note)
      return
    }
    if (msg.type === 'live-sync') {
      this.liveNotes = mergeNotes(this.liveNotes, msg.notes)
      saveLiveNotes(this.liveNotes)
      this.emitState()
      return
    }
    if (msg.type === 'live-clear') {
      this.liveNotes = []
      saveLiveNotes(this.liveNotes)
      this.emitState()
    }
  }

  private addNote(note: LiveNote): void {
    this.liveNotes = mergeNotes(this.liveNotes, [note])
    saveLiveNotes(this.liveNotes)
    this.emitState()
  }

  private async broadcast(msg: ControlMessage): Promise<void> {
    const links = [...this.liveLinks].filter((link) => link.open)
    await Promise.all(links.map((link) => link.send(msg).catch(() => link.close())))
  }

  private resolvePeer(peerId?: string): PeerInfo | undefined {
    const peers = this.discovery.list()
    if (peerId) return this.discovery.get(peerId) || peers.find((peer) => peer.id === peerId)
    if (this.config.lastPeerId) {
      const last = this.discovery.get(this.config.lastPeerId)
      if (last) return last
    }
    return peers[0]
  }

  private trustPeer(peer: PeerInfo): void {
    const next = this.config.trustedPeers.filter(
      (item) => item.id !== peer.id && item.fingerprint !== peer.fingerprint
    )
    next.push({
      id: peer.id,
      name: peer.name,
      fingerprint: peer.fingerprint,
      lastHost: peer.host,
      lastPort: peer.port
    })
    this.config.trustedPeers = next
    this.config.lastPeerId = peer.id
    this.config.lastManualHost = peer.host
    this.discovery.setTrusted(next)
    this.discovery.markLinked(peer.id, true)
    saveConfig(this.config)
  }

  private syncIdentity(): void {
    this.discovery.setIdentity({
      id: this.config.deviceId,
      name: this.config.deviceName,
      port: this.config.tcpPort,
      fingerprint: this.tls.fingerprint
    })
    this.server.setIdentity({
      id: this.config.deviceId,
      name: this.config.deviceName,
      pin: this.config.pin,
      receiveDir: this.config.receiveDir,
      fingerprint: this.tls.fingerprint
    })
  }

  private emitState(): void {
    this.emit('state', this.getState())
  }
}
