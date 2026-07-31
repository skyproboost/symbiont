import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseNameOnlyLog, pairCounts, partnersOf } from '../src/graph/cochange'
import { buildPassport } from '../src/passport/build'
import { callTool } from '../src/mcp/handlers'

describe('parseNameOnlyLog', () => {
  it('коммиты разбираются, не-кодовые файлы отсеиваются', () => {
    const log = `@abc123\nsrc/a.ts\nREADME.md\nassets/logo.png\n\n@def456\nsrc/a.ts\nsrc/b.ts\nmigrations/001.sql\n`
    const commits = parseNameOnlyLog(log)
    expect(commits).toEqual([['src/a.ts'], ['src/a.ts', 'src/b.ts', 'migrations/001.sql']])
  })
})

describe('pairCounts + partnersOf', () => {
  it('пары считаются, гигантские коммиты отбрасываются', () => {
    const commits = [
      ['schema.ts', 'migration.sql', 'test.ts'],
      ['schema.ts', 'migration.sql'],
      ['schema.ts', 'migration.sql', 'other.ts'],
      Array.from({ length: 40 }, (_, i) => `bulk${i}.ts`), // bulk — шум
    ]
    const data = pairCounts(commits)
    expect(data.pairs.get('migration.sql|schema.ts')).toBe(3)
    expect(data.totals.get('schema.ts')).toBe(3)
    expect(data.totals.get('bulk0.ts')).toBeUndefined()

    const partners = partnersOf('schema.ts', data)
    expect(partners[0].file).toBe('migration.sql')
    expect(partners[0].together).toBe(3)
    expect(partners[0].share).toBe(1)
  })

  it('редкие пары (n<2) отсеиваются', () => {
    const data = pairCounts([['a.ts', 'b.ts']])
    expect(partnersOf('a.ts', data)).toEqual([])
  })
})

describe('интеграция: co-change из настоящего git', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-cochange-'))
  const g = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
  g('init', '-b', 'main')
  // три коммита: schema+migration всегда вместе
  for (let i = 1; i <= 3; i++) {
    writeFileSync(join(proj, 'schema.js'), `var v = ${i};\n`.repeat(10))
    writeFileSync(join(proj, 'migration.sql'), `-- v${i}\n`)
    writeFileSync(join(proj, 'lone.js'), i === 1 ? 'var x = 1;\n' : `var x = ${i};\n`)
    g('add', '.')
    g('commit', '-m', `фича ${i}`)
  }
  const data = mkdtempSync(join(tmpdir(), 'symbiont-cochange-data-'))

  it('passport_related: schema ↔ migration найдены', () => {
    buildPassport(proj, data)
    const text = callTool('passport_related', { file: 'schema.js' }, data)
    expect(text).toContain('Вместе с schema.js')
    expect(text).toContain('migration.sql')
    expect(text).toContain('100% его правок')
  })

  it('без новых коммитов co-change из кэша (git-head не менялся)', () => {
    const r = buildPassport(proj, data)
    expect(r.factsExecuted).toBe(false) // и остальное тоже из кэша
    const text = callTool('passport_related', { file: 'schema.js' }, data)
    expect(text).toContain('migration.sql')
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(data, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
