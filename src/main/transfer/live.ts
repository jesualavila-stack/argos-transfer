import { randomUUID } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import {
  LIVE_MAX_CHARS,
  LIVE_MAX_IMAGE_BYTES,
  LIVE_MAX_NOTES,
  LIVE_PING_MS
} from '../../shared/constants'
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
    kind: 'text',
    text: clean,
    fromId,
    fromName,
    at: Date.now()
  }
}

export function createLiveImageNote(
  image: string,
  fromId: string,
  fromName: string,
  caption = ''
): LiveNote | null {
  if (!isDataImage(image)) return null
  if (Buffer.byteLength(image, 'utf8') > LIVE_MAX_IMAGE_BYTES * 1.4) return null
  return {
    id: randomUUID(),
    kind: 'image',
    text: normalizeNoteText(caption) || 'Captura',
    image,
    fromId,
    fromName,
    at: Date.now()
  }
}

export function isDataImage(value: string | undefined): boolean {
  return Boolean(value && /^data:image\/(png|jpe?g|webp);base64,/i.test(value))
}

export function normalizeLiveNote(note: Partial<LiveNote>): LiveNote | null {
  if (!note.id) return null
  const image = isDataImage(note.image) ? note.image : undefined
  const kind = image ? 'image' : 'text'
  const text = normalizeNoteText(note.text || (kind === 'image' ? 'Captura' : ''))
  if (kind === 'text' && !text) return null
  if (kind === 'image' && !image) return null
  return {
    id: note.id,
    kind,
    text,
    image,
    fromId: note.fromId || '',
    fromName: note.fromName || 'PC',
    at: typeof note.at === 'number' ? note.at : Date.now()
  }
}

export function mergeNotes(current: LiveNote[], incoming: LiveNote[]): LiveNote[] {
  const byId = new Map(current.map((note) => [note.id, note]))
  for (const note of incoming) {
    const clean = normalizeLiveNote(note)
    if (!clean) continue
    byId.set(clean.id, clean)
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
