import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimMaintenance, handOffMaintenance } from '../src/core/codex-maintenance'

test.skipIf(process.platform !== 'win32')('Codex maintenance belongs to its cwd and a single worker, including overlapping requests', () => {
  const root = mkdtempSync(join(tmpdir(), 'symbiont-handoff-'))
  const first = join(root, 'one', 'app'), other = join(root, 'two', 'app'), data = join(root, 'data')
  const oldHost = process.env.SYMBIONT_HOST
  const locks: Array<() => void> = []
  try {
    for (const dir of [first, other, data]) mkdirSync(dir, { recursive: true })
    process.env.SYMBIONT_HOST = 'claude'
    expect(handOffMaintenance(first, data)).toBe(false)
    process.env.SYMBIONT_HOST = 'codex'
    handOffMaintenance(first, data)
    handOffMaintenance(first, data)
    expect(claimMaintenance(other, data)).toBeNull()
    const release = claimMaintenance(first, data)!
    expect(typeof release).toBe('function')
    locks.push(release)
    expect(claimMaintenance(first, data)).toBeNull()
    handOffMaintenance(first, data)
    expect(claimMaintenance(first, data)).toBeNull()
    locks.pop()!()
    const next = claimMaintenance(first, data)!
    expect(typeof next).toBe('function')
    locks.push(next)
    expect(claimMaintenance(first, data)).toBeNull()
  } finally {
    for (const release of locks) release()
    if (oldHost === undefined) delete process.env.SYMBIONT_HOST
    else process.env.SYMBIONT_HOST = oldHost
    rmSync(root, { recursive: true, force: true })
  }
})
