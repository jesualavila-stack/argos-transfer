import { createHash, randomInt, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import selfsigned from 'selfsigned'
import { getDataDir } from './store'

export type TlsMaterial = {
  cert: string
  key: string
  fingerprint: string
}

export function suggestDeviceName(): string {
  const host = hostname()
  const user = userInfo().username
  return `${user} · ${host}`
}

export function newDeviceId(): string {
  return randomUUID()
}

export function newPin(): string {
  return String(randomInt(100000, 1000000))
}

export function certFingerprint(certPem: string): string {
  return createHash('sha256').update(certPem).digest('hex')
}

export function loadOrCreateTls(): TlsMaterial {
  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'tls.json')
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as TlsMaterial
    if (saved.cert && saved.key && saved.fingerprint) {
      return saved
    }
  }
  const pems = selfsigned.generate([{ name: 'commonName', value: 'Argos Transfer' }], {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256'
  })
  const material: TlsMaterial = {
    cert: pems.cert,
    key: pems.private,
    fingerprint: certFingerprint(pems.cert)
  }
  writeFileSync(file, JSON.stringify(material, null, 2), 'utf8')
  return material
}
