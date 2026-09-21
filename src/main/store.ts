import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_PIN, DEFAULT_TCP_PORT, LIVE_MAX_NOTES } from '../shared/constants'
import type { LiveNote, TrustedPeer } from '../shared/types'
import { normalizeLiveNote } from './transfer/live'

export type AppConfig = {
  deviceId: string
  deviceName: string
  pin: string
  tcpPort: number
  receiveDir: string
  dockEnabled: boolean
  lastPeerId: string | null
  lastManualHost: string | null
  sendOnly: boolean
  trustedPeers: TrustedPeer[]
}

export function getDataDir(): string {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR
  if (portable) {
    return join(portable, 'argos-data')
  }
  return app.getPath('userData')
}

export function loadConfig(
  defaults: Pick<AppConfig, 'deviceId' | 'deviceName' | 'receiveDir'>
): AppConfig {
  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'config.json')
  if (!existsSync(file)) {
    const fresh: AppConfig = {
      ...defaults,
      pin: DEFAULT_PIN,
      tcpPort: DEFAULT_TCP_PORT,
      dockEnabled: true,
      lastPeerId: null,
      lastManualHost: null,
      sendOnly: false,
      trustedPeers: []
    }
    writeFileSync(file, JSON.stringify(fresh, null, 2), 'utf8')
    return fresh
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>
  return {
    deviceId: parsed.deviceId || defaults.deviceId,
    deviceName: parsed.deviceName || defaults.deviceName,
    pin: parsed.pin || DEFAULT_PIN,
    tcpPort: parsed.tcpPort || DEFAULT_TCP_PORT,
    receiveDir: parsed.receiveDir || defaults.receiveDir,
    dockEnabled: parsed.dockEnabled !== false,
    lastPeerId: parsed.lastPeerId ?? null,
    lastManualHost: parsed.lastManualHost ?? null,
    sendOnly: parsed.sendOnly === true,
    trustedPeers: parsed.trustedPeers ?? []
  }
}

export function saveConfig(config: AppConfig): void {
  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
}

export function loadLiveNotes(): LiveNote[] {
  const file = join(getDataDir(), 'live-notes.json')
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => normalizeLiveNote(item as Partial<LiveNote>))
      .filter((item): item is LiveNote => Boolean(item))
      .slice(-LIVE_MAX_NOTES)
  } catch {
    return []
  }
}

export function saveLiveNotes(notes: LiveNote[]): void {
  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'live-notes.json'),
    JSON.stringify(notes.slice(-LIVE_MAX_NOTES), null, 2),
    'utf8'
  )
}
