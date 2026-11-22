/** Extract only file headers; never execute patch text or interpret content as paths. */
import { isAbsolute, resolve } from 'node:path'

export function patchPaths(command: unknown, cwd: string): string[] {
  if (typeof command !== 'string' || !command.trimStart().startsWith('*** Begin Patch')) return []
  const paths = new Set<string>()
  for (const line of command.split(/\r?\n/)) {
    const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line)
    if (!match || match[1].includes('\0')) continue
    paths.add(isAbsolute(match[1]) ? match[1] : resolve(cwd, match[1]))
  }
  return [...paths]
}
