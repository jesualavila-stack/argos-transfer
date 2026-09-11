import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import type { AppState, PeerInfo, TransferSnapshot } from '../../shared/types'
import type { AppConfig } from '../store'
import { saveConfig } from '../store'
import type { TlsMaterial } from '../identity'
import { Discovery } from './discovery'
import { TransferServer } from './server'
import { sendFilesToPeer } from './client'
import { collectFiles } from './files'

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
    this.discovery.setTrusted(this.config.trustedPeers)
    this.restoreKnownHosts()
    if (this.config.sendOnly) {
      this.statusText = 'Solo enviar · sin abrir puertos. Conectá por IP.'
      this.emitState()
      saveConfig(this.config)
      return
    }
    await this.startListening()
  }

  async setSendOnly(enabled: boolean): Promise<void> {
    this.config.sendOnly = enabled
    saveConfig(this.config)
    if (enabled) {
      this.discovery.stop()
      this.server.stop()
      this.listening = false
      this.restoreKnownHosts()
      this.statusText = 'Solo enviar · sin abrir puertos. Conectá por IP.'
      this.emitState()
      return
    }
    await this.startListening()
  }

  stop(): void {
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
      sendOnly: this.config.sendOnly
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

  connectManual(host: string, port?: number): PeerInfo {
    const peer = this.discovery.rememberManual(host.trim(), port || this.config.tcpPort, 'PC Casa')
    this.config.lastPeerId = peer.id
    this.config.lastManualHost = host.trim()
    saveConfig(this.config)
    this.statusText = `Listo para enviar a ${peer.name}`
    this.emitState()
    return peer
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
    if (this.config.lastManualHost) {
      this.discovery.rememberManual(this.config.lastManualHost, this.config.tcpPort, 'PC Casa')
    }
    for (const trusted of this.config.trustedPeers) {
      if (trusted.lastHost) {
        this.discovery.rememberManual(
          trusted.lastHost,
          trusted.lastPort || this.config.tcpPort,
          trusted.name
        )
      }
    }
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
    this.discovery.setTrusted(next)
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
