import { createReadStream } from 'node:fs'
import { connect, type TLSSocket } from 'node:tls'
import { CHUNK_SIZE } from '../../shared/constants'
import type { FileMeta } from '../../shared/types'
import { Session } from './framing'

export type LiveChannel = {
  session: Session
  socket: TLSSocket
  peerName: string
}

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

export async function pairWithPeer(options: {
  host: string
  port: number
  identity: ClientIdentity
}): Promise<{ id: string; name: string; fingerprint: string }> {
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
    return { id: auth.id, name: auth.name, fingerprint: auth.fingerprint }
  } finally {
    socket.end()
  }
}

export async function openLiveChannel(options: {
  host: string
  port: number
  identity: ClientIdentity
}): Promise<LiveChannel> {
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
    await session.send({ type: 'live-open' })
    const reply = await session.nextMessage()
    if (reply.type !== 'live-ok') {
      throw new Error(
        'La otra PC no tiene pizarra en vivo. Actualizá ARGOS TRANSFER en esa máquina.'
      )
    }
    return { session, socket, peerName: auth.name }
  } catch (error) {
    socket.end()
    throw error
  }
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

function connectTls(host: string, port: number, timeoutMs = 8000): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      {
        host,
        port,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.3'
      },
      () => {
        socket.setTimeout(0)
        resolve(socket)
      }
    )
    socket.setTimeout(timeoutMs, () => {
      socket.destroy()
      reject(new Error(`Tiempo de espera al conectar con ${host}:${port}`))
    })
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
