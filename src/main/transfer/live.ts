import { randomUUID } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import { LIVE_MAX_CHARS, LIVE_MAX_NOTES, LIVE_PING_MS } from '../../shared/constants'
import type { ControlMessage, LiveNote } from '../../shared/types'
import type { Session } from './framing'

export function normalizeNoteText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim().slice(0, LIVE_MAX_CHARS)
}

export function createLiveNote(text: string, fromId: string, fromName: string): LiveNote | null {
  const clean = normalizeNoteText(text)
  if (!clean) return null
  return {
    id: randomUUID(),
    text: clean,
    fromId,
    fromName,
    at: Date.now()
  }
}

export function mergeNotes(current: LiveNote[], incoming: LiveNote[]): LiveNote[] {
  const byId = new Map(current.map((note) => [note.id, note]))
  for (const note of incoming) {
    if (!note.id || !note.text) continue
    byId.set(note.id, {
      id: note.id,
      text: normalizeNoteText(note.text),
      fromId: note.fromId || '',
      fromName: note.fromName || 'PC',
      at: typeof note.at === 'number' ? note.at : Date.now()
    })
  }
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-LIVE_MAX_NOTES)
}

export class LiveLink {
  open = true
  private pingTimer: NodeJS.Timeout | null = null
  private closed = false
  private readonly session: Session
  private readonly socket: TLSSocket
  private readonly onMessage: (msg: ControlMessage) => void
  private readonly onClose: () => void

  constructor(
    session: Session,
    socket: TLSSocket,
    onMessage: (msg: ControlMessage) => void,
    onClose: () => void
  ) {
    this.session = session
    this.socket = socket
    this.onMessage = onMessage
    this.onClose = onClose
    socket.on('close', () => this.close())
    socket.on('error', () => this.close())
    this.pingTimer = setInterval(() => {
      void this.session.send({ type: 'live-ping' }).catch(() => this.close())
    }, LIVE_PING_MS)
    void this.loop()
  }

  async send(msg: ControlMessage): Promise<void> {
    if (!this.open) throw new Error('Pizarra desconectada')
    await this.session.send(msg)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.open = false
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    this.socket.end()
    this.onClose()
  }

  private async loop(): Promise<void> {
    while (this.open) {
      const msg = await this.session.nextMessage()
      if (!this.open) return
      if (msg.type === 'error') {
        this.close()
        return
      }
      if (msg.type === 'live-ping') {
        void this.session.send({ type: 'live-pong' }).catch(() => this.close())
        continue
      }
      if (msg.type === 'live-pong') continue
      this.onMessage(msg)
    }
  }
}
