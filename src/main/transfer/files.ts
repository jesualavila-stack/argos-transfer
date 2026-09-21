import { createWriteStream, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { readdir } from 'node:fs/promises'
import type { FileMeta, InboxItem } from '../../shared/types'

const INBOX_MAX = 120

export async function collectFiles(paths: string[]): Promise<{ files: FileMeta[]; abs: string[] }> {
  const files: FileMeta[] = []
  const abs: string[] = []

  for (const input of paths) {
    const full = resolve(input)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      const entries = await readdir(full, { recursive: true, withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const filePath = join(entry.parentPath ?? full, entry.name)
        const rel = relative(dirname(full), filePath).split(sep).join('/')
        files.push({ name: entry.name, relativePath: rel, size: statSync(filePath).size })
        abs.push(filePath)
      }
    } else if (stat.isFile()) {
      files.push({ name: basename(full), relativePath: basename(full), size: stat.size })
      abs.push(full)
    }
  }

  return { files, abs }
}

export function resolveReceivePath(receiveDir: string, relativePath: string): string {
  const safe = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '..')
  return join(receiveDir, ...safe)
}

export function createSafeWriteStream(
  receiveDir: string,
  relativePath: string
): ReturnType<typeof createWriteStream> {
  const target = resolveReceivePath(receiveDir, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  return createWriteStream(target)
}

export function isPathInsideDir(filePath: string, dir: string): boolean {
  const root = resolve(dir)
  const full = resolve(filePath)
  return full === root || full.startsWith(root + sep)
}

export async function listInbox(receiveDir: string): Promise<InboxItem[]> {
  const root = resolve(receiveDir)
  mkdirSync(root, { recursive: true })
  const items: InboxItem[] = []
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name.startsWith('_probe') || entry.name.startsWith('.')) continue
      const filePath = join(entry.parentPath ?? root, entry.name)
      if (!isPathInsideDir(filePath, root)) continue
      try {
        const st = statSync(filePath)
        items.push({
          path: filePath,
          name: entry.name,
          relativePath: relative(root, filePath).split(sep).join('/'),
          size: st.size,
          mtime: st.mtimeMs
        })
      } catch {
        // skip unreadable
      }
    }
  } catch {
    return []
  }
  return items.sort((a, b) => b.mtime - a.mtime).slice(0, INBOX_MAX)
}
