import type { Duplex } from 'node:stream'
import type { ControlMessage } from '../../shared/types'

export function encodeFrame(msg: ControlMessage): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(json.length)
  return Buffer.concat([header, json])
}

export type FrameEvent = { kind: 'msg'; msg: ControlMessage } | { kind: 'data'; chunk: Buffer }

export class FrameReader {
  private buf = Buffer.alloc(0)
  private fileLeft = 0

  expectFile(size: number): void {
    this.fileLeft = size
  }

  push(chunk: Buffer): FrameEvent[] {
    this.buf = Buffer.concat([this.buf, chunk])
    const out: FrameEvent[] = []

    while (this.buf.length > 0) {
      if (this.fileLeft > 0) {
        const take = Math.min(this.fileLeft, this.buf.length)
        out.push({ kind: 'data', chunk: this.buf.subarray(0, take) })
        this.buf = this.buf.subarray(take)
        this.fileLeft -= take
        continue
      }

      if (this.buf.length < 4) break
      const len = this.buf.readUInt32BE(0)
      if (len > 8 * 1024 * 1024) {
        throw new Error('Frame demasiado grande')
      }
      if (this.buf.length < 4 + len) break
      const raw = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.subarray(4 + len)
      const msg = JSON.parse(raw.toString('utf8')) as ControlMessage
      if (msg.type === 'file-begin') {
        this.expectFile(msg.size)
      }
      out.push({ kind: 'msg', msg })
    }

    return out
  }
}

export class Session {
  private readonly reader = new FrameReader()
  private readonly messages: ControlMessage[] = []
  private readonly dataChunks: Buffer[] = []
  private waitMsg: ((msg: ControlMessage) => void) | null = null
  private waitData: ((chunk: Buffer | null) => void) | null = null
  private closed = false
  private readonly socket: Duplex

  constructor(socket: Duplex) {
    this.socket = socket
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const event of this.reader.push(chunk)) {
          if (event.kind === 'msg') {
            if (this.waitMsg) {
              const resolve = this.waitMsg
              this.waitMsg = null
              resolve(event.msg)
            } else {
              this.messages.push(event.msg)
            }
          } else {
            if (this.waitData) {
              const resolve = this.waitData
              this.waitData = null
              resolve(event.chunk)
            } else {
              this.dataChunks.push(event.chunk)
            }
          }
        }
      } catch (error) {
        this.socket.destroy(error instanceof Error ? error : new Error(String(error)))
      }
    })

    socket.on('close', () => {
      this.closed = true
      this.waitMsg?.({
        type: 'error',
        message: 'Conexión cerrada'
      } as ControlMessage)
      this.waitData?.(null)
    })

    socket.on('error', () => {
      this.closed = true
    })
  }

  async send(msg: ControlMessage): Promise<void> {
    await this.write(encodeFrame(msg))
  }

  async sendRaw(buf: Buffer): Promise<void> {
    await this.write(buf)
  }

  nextMessage(): Promise<ControlMessage> {
    if (this.messages.length > 0) {
      return Promise.resolve(this.messages.shift() as ControlMessage)
    }
    if (this.closed) {
      return Promise.resolve({ type: 'error', message: 'Conexión cerrada' })
    }
    return new Promise((resolve) => {
      this.waitMsg = resolve
    })
  }

  async *readFileBytes(size: number): AsyncGenerator<Buffer> {
    let left = size
    while (left > 0) {
      let chunk: Buffer | undefined = this.dataChunks.shift()
      if (!chunk) {
        const next = await new Promise<Buffer | null>((resolve) => {
          this.waitData = resolve
        })
        chunk = next ?? undefined
      }
      if (!chunk) {
        throw new Error('Conexión interrumpida durante la transferencia')
      }
      left -= chunk.length
      yield chunk
    }
  }

  private write(buf: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const ok = this.socket.write(buf, (error) => {
        if (error) reject(error)
      })
      if (ok) resolve()
      else this.socket.once('drain', () => resolve())
    })
  }
}
