export function parseSendArgs(argv: string[]): string[] {
  const idx = argv.findIndex((arg) => arg === '--send')
  if (idx === -1) return []
  return argv.slice(idx + 1).filter((arg) => arg && !arg.startsWith('--'))
}
