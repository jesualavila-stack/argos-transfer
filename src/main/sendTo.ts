import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

function sendToDir(): string {
  return join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'SendTo')
}

function shortcutPath(label: string): string {
  const safe = label.replace(/[<>:"/\\|?*]/g, '').trim() || 'PC Casa'
  return join(sendToDir(), `Argos Transfer — ${safe}.cmd`)
}

export function installSendTo(label: string): { ok: boolean; path?: string; message?: string } {
  if (!app.isPackaged) {
    return {
      ok: false,
      message: 'El menú Enviar a se instala desde el .exe portable, no desde npm run dev.'
    }
  }
  const dir = sendToDir()
  mkdirSync(dir, { recursive: true })
  const target = shortcutPath(label)
  const exe = app.getPath('exe')
  const body = ['@echo off', 'setlocal EnableExtensions', `start "" "${exe}" --send %*`].join(
    '\r\n'
  )
  writeFileSync(target, body, 'utf8')
  return { ok: true, path: target }
}

export function removeSendTo(label = 'PC Casa'): void {
  const target = shortcutPath(label)
  if (existsSync(target)) {
    unlinkSync(target)
  }
}

export function isSendToInstalled(label = 'PC Casa'): boolean {
  return existsSync(shortcutPath(label))
}
