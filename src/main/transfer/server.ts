import { createWriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import { createServer, type TLSSocket } from 'node:tls'
import { EventEmitter } from 'node:events'
import type { FileMeta } from '../../shared/types'
import { Session } from './framing'
import { createSafeWriteStream } from './files'
import type { TlsMaterial } from '../identity'

export type ServerIdentity = {
  id: string
  name: string
  pin: string
  receiveDir: string
  fingerprint: string
}

export class TransferServer extends EventEmitter {
  private server: ReturnType<typeof createServer> | null = null
  private port = 0
  private identity: ServerIdentity

  constructor(
    private readonly tls: TlsMaterial,
    identity: ServerIdentity
  ) {
    super()
    this.identity = identity
  }

  setIdentity(identity: ServerIdentity): void {
    this.identity = identity
  }

  getPort(): number {
    return this.port
  }

  start(preferredPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer(
        {
          key: this.tls.key,
          cert: this.tls.cert,
          minVersion: 'TLSv1.3'
        },
        (socket) => {
          void this.handle(socket as TLSSocket)
        }
      )

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' && preferredPort !== 0) {
          server.listen(0)
          return
        }
        reject(error)
      })

      server.listen(preferredPort, '0.0.0.0', () => {
        const address = server.address()
        this.port = address && typeof address === 'object' ? address.port : preferredPort
        this.server = server
        resolve(this.port)
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private async handle(socket: TLSSocket): Promise<void> {
    const session = new Session(socket)
    let keepOpen = false
    try {
      const first = await session.nextMessage()
      if (first.type !== 'auth') {
        await session.send({ type: 'auth-fail', reason: 'Handshake inválido' })
        socket.end()
        return
      }
      if (first.pin !== this.identity.pin) {
        await session.send({ type: 'auth-fail', reason: 'PIN incorrecto' })
        socket.end()
        return
      }

      await session.send({
        type: 'auth-ok',
        id: this.identity.id,
        name: this.identity.name,
        fingerprint: this.identity.fingerprint
      })

      const second = await session.nextMessage()
      if (second.type === 'live-open') {
        await session.send({ type: 'live-ok' })
        keepOpen = true
        this.emit('live', {
          session,
          socket,
          peerName: first.name,
          peerId: first.id
        })
        return
      }
      if (second.type !== 'offer') {
        await session.send({ type: 'reject', reason: 'Se esperaba una oferta de archivos' })
        return
      }
      const offer = second

      const total = offer.files.reduce((sum, file) => sum + file.size, 0)
      this.emit('incoming', { peerName: first.name, files: offer.files, total })
      await session.send({ type: 'accept' })

      let transferred = 0
      const started = Date.now()
      for (let i = 0; i < offer.files.length; i += 1) {
        const begin = await session.nextMessage()
        if (begin.type !== 'file-begin') {
          throw new Error('Faltó el encabezado del archivo')
        }
        const stream = createSafeWriteStream(this.identity.receiveDir, begin.relativePath)
        await this.writeFile(session, stream, begin.size, (delta) => {
          transferred += delta
          this.emitProgress(first.name, begin.name, transferred, total, started)
        })
        const end = await session.nextMessage()
        if (end.type !== 'file-end') {
          throw new Error('Archivo incompleto')
        }
      }

      const done = await session.nextMessage()
      if (done.type !== 'done') {
        throw new Error('La transferencia no cerró bien')
      }
      this.emit('complete', { peerName: first.name, files: offer.files, total })
    } catch (error) {
      this.emit('error', error)
      try {
        await session.send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Error al recibir'
        })
      } catch {
        // socket already gone
      }
    } finally {
      if (!keepOpen) socket.end()
    }
  }

  private emitProgress(
    peerName: string,
    fileName: string,
    transferred: number,
    total: number,
    started: number
  ): void {
    const elapsed = Math.max(1, Date.now() - started) / 1000
    this.emit('progress', {
      direction: 'receive',
      peerName,
      fileName,
      transferred,
      total,
      bytesPerSec: transferred / elapsed
    })
  }

  private writeFile(
    session: Session,
    stream: ReturnType<typeof createWriteStream>,
    size: number,
    onChunk: (bytes: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      void (async () => {
        try {
          for await (const chunk of session.readFileBytes(size)) {
            if (!stream.write(chunk)) {
              await new Promise<void>((res) => stream.once('drain', res))
            }
            onChunk(chunk.length)
          }
          stream.end()
          await finished(stream)
          resolve()
        } catch (error) {
          stream.destroy()
          reject(error)
        }
      })()
    })
  }
}

export type IncomingOffer = {
  peerName: string
  files: FileMeta[]
  total: number
}
