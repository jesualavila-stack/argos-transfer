import { createReadStream } from 'node:fs'
import { connect, type TLSSocket } from 'node:tls'
import { CHUNK_SIZE } from '../../shared/constants'
import type { FileMeta } from '../../shared/types'
import { Session } from './framing'

export type ClientIdentity = {
  id: string
  name: string
  pin: string
  fingerprint: string
}

export type SendProgress = {
  direction: 'send'
  peerName: string
  fileName: string
  transferred: number
  total: number
  bytesPerSec: number
}

export async function sendFilesToPeer(options: {
  host: string
  port: number
  peerName: string
  identity: ClientIdentity
  files: FileMeta[]
  absPaths: string[]
  onProgress: (progress: SendProgress) => void
}): Promise<void> {
  const socket = await connectTls(options.host, options.port)
  const session = new Session(socket)

  try {
    await session.send({
      type: 'auth',
      id: options.identity.id,
      name: options.identity.name,
      pin: options.identity.pin
    })
    const auth = await session.nextMessage()
    if (auth.type !== 'auth-ok') {
      const reason = auth.type === 'auth-fail' ? auth.reason : 'No se pudo emparejar'
      throw new Error(reason)
    }

    await session.send({ type: 'offer', files: options.files })
    const answer = await session.nextMessage()
    if (answer.type !== 'accept') {
      const reason = answer.type === 'reject' ? answer.reason : 'El destino rechazó los archivos'
      throw new Error(reason)
    }

    const total = options.files.reduce((sum, file) => sum + file.size, 0)
    let transferred = 0
    const started = Date.now()

    for (let i = 0; i < options.files.length; i += 1) {
      const meta = options.files[i]
      const abs = options.absPaths[i]
      if (!meta || !abs) continue
      await session.send({
        type: 'file-begin',
        name: meta.name,
        relativePath: meta.relativePath,
        size: meta.size
      })
      await streamFile(session, abs, (delta) => {
        transferred += delta
        const elapsed = Math.max(1, Date.now() - started) / 1000
        options.onProgress({
          direction: 'send',
          peerName: options.peerName,
          fileName: meta.name,
          transferred,
          total,
          bytesPerSec: transferred / elapsed
        })
      })
      await session.send({ type: 'file-end' })
    }

    await session.send({ type: 'done' })
  } finally {
    socket.end()
  }
}

function connectTls(host: string, port: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      {
        host,
        port,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.3'
      },
      () => resolve(socket)
    )
    socket.once('error', reject)
  })
}

function streamFile(
  session: Session,
  absPath: string,
  onChunk: (bytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(absPath, { highWaterMark: CHUNK_SIZE })
    stream.on('data', (chunk: string | Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stream.pause()
      void session
        .sendRaw(buf)
        .then(() => {
          onChunk(buf.length)
          stream.resume()
        })
        .catch(reject)
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
}
