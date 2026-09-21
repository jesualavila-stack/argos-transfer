import { createSocket, type Socket } from 'node:dgram'
import { EventEmitter } from 'node:events'
import { DEFAULT_UDP_PORT, HELLO_INTERVAL_MS, MAGIC, PEER_TTL_MS } from '../../shared/constants'
import type { HelloPacket, PeerInfo, TrustedPeer } from '../../shared/types'

export type DiscoveryIdentity = {
  id: string
  name: string
  port: number
  fingerprint: string
}

export class Discovery extends EventEmitter {
  private socket: Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private pruneTimer: NodeJS.Timeout | null = null
  private readonly peers = new Map<string, PeerInfo>()
  private trusted: TrustedPeer[] = []

  constructor(private identity: DiscoveryIdentity) {
    super()
  }

  setIdentity(identity: DiscoveryIdentity): void {
    this.identity = identity
  }

  setTrusted(peers: TrustedPeer[]): void {
    this.trusted = peers
    for (const peer of this.peers.values()) {
      const known = peers.find(
        (item) => item.id === peer.id || item.fingerprint === peer.fingerprint
      )
      peer.trusted = Boolean(known)
    }
    this.emit('peers', this.list())
  }

  list(): PeerInfo[] {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): PeerInfo | undefined {
    return this.peers.get(id)
  }

  rememberManual(host: string, port: number, name = host): PeerInfo {
    const id = `manual:${host}:${port}`
    const existing = this.peers.get(id)
    const peer: PeerInfo = {
      id,
      name: existing?.name || name,
      host,
      port,
      fingerprint: existing?.fingerprint || '',
      lastSeen: Date.now(),
      trusted: existing?.trusted || this.trusted.some((item) => item.lastHost === host),
      linked: existing?.linked ?? false
    }
    this.peers.set(id, peer)
    this.emit('peers', this.list())
    return peer
  }

  markLinked(
    id: string,
    linked: boolean,
    extras?: Partial<Pick<PeerInfo, 'name' | 'fingerprint'>>
  ): void {
    const peer = this.peers.get(id)
    if (!peer) return
    peer.linked = linked
    peer.lastSeen = Date.now()
    if (extras?.name) peer.name = extras.name
    if (extras?.fingerprint) peer.fingerprint = extras.fingerprint
    this.peers.set(id, peer)
    this.emit('peers', this.list())
  }

  start(): void {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket

    socket.on('message', (raw, info) => {
      try {
        const packet = JSON.parse(raw.toString('utf8')) as HelloPacket
        if (packet.magic !== MAGIC || packet.v !== 1 || packet.type !== 'hello') return
        if (packet.id === this.identity.id) return
        const trusted = this.trusted.some(
          (item) => item.id === packet.id || item.fingerprint === packet.fingerprint
        )
        const previous = this.peers.get(packet.id)
        this.peers.set(packet.id, {
          id: packet.id,
          name: packet.name,
          host: info.address,
          port: packet.port,
          fingerprint: packet.fingerprint,
          lastSeen: Date.now(),
          trusted: trusted || Boolean(previous?.trusted),
          linked: true
        })
        this.emit('peers', this.list())
      } catch {
        // ignore noise on the LAN
      }
    })

    socket.on('error', (error) => {
      this.emit('error', error)
    })

    socket.bind(DEFAULT_UDP_PORT, () => {
      socket.setBroadcast(true)
      this.announce()
      this.timer = setInterval(() => this.announce(), HELLO_INTERVAL_MS)
      this.pruneTimer = setInterval(() => this.prune(), 2000)
    })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.timer = null
    this.pruneTimer = null
    this.socket?.close()
    this.socket = null
  }

  private announce(): void {
    const packet: HelloPacket = {
      magic: MAGIC,
      v: 1,
      type: 'hello',
      id: this.identity.id,
      name: this.identity.name,
      port: this.identity.port,
      fingerprint: this.identity.fingerprint
    }
    const buf = Buffer.from(JSON.stringify(packet), 'utf8')
    try {
      this.socket?.send(buf, DEFAULT_UDP_PORT, '255.255.255.255')
    } catch {
      // broadcast can fail on isolated adapters
    }
  }

  private prune(): void {
    const now = Date.now()
    let changed = false
    for (const [id, peer] of this.peers) {
      if (id.startsWith('manual:')) continue
      if (now - peer.lastSeen > PEER_TTL_MS) {
        this.peers.delete(id)
        changed = true
      }
    }
    if (changed) this.emit('peers', this.list())
  }
}
