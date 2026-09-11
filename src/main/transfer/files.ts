import { createWriteStream, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { readdir } from 'node:fs/promises'
import type { FileMeta } from '../../shared/types'

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

export function createSafeWriteStream(
  receiveDir: string,
  relativePath: string
): ReturnType<typeof createWriteStream> {
  const safe = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '..')
  const target = join(receiveDir, ...safe)
  mkdirSync(dirname(target), { recursive: true })
  return createWriteStream(target)
}
