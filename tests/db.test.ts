/**
 * Слой хранилища: снятие обязательной предпосылки к окружению (CONCEPT §7).
 *
 * Главная проверка — ПАРИТЕТ драйверов: один и тот же сценарий гоняется под bun
 * (в процессе теста) и под node (реальным процессом с собранным входом), ответы
 * обязаны совпасть до байта. Проверять node-ветку заглушками бессмысленно: она
 * ломается именно на настоящем node:sqlite, который в bun не существует.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb, driverKind } from '../src/core/db'
import { dbScenario } from './_db-scenario'

const ROOT = join(import.meta.dirname, '..')

/** Тот же сценарий, но под node: вход собирается и запускается процессом. */
function scenarioUnderNode(): { ok: boolean; note: string; result: Record<string, unknown> | null } {
  const dir = mkdtempSync(join(tmpdir(), 'symbiont-db-node-'))
  try {
    const entry = join(dir, 'entry.ts')
    const scenario = join(ROOT, 'tests', '_db-scenario.ts').replace(/\\/g, '/')
    writeFileSync(
      entry,
      `import { dbScenario } from '${scenario}'\nconsole.log(JSON.stringify(dbScenario(process.argv[2])))\n`,
      'utf8',
    )
    const built = spawnSync(
      'bun',
      ['build', entry, '--target', 'node', '--outfile', join(dir, 'entry.js')],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true },
    )
    if (built.status !== 0) return { ok: false, note: `сборка входа: ${(built.stderr ?? '').slice(0, 200)}`, result: null }

    const run = spawnSync('node', [join(dir, 'entry.js'), join(dir, 'probe.db')], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    })
    if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, note: 'на машине нет node — рантайм поставки проверить нечем', result: null }
    }
    if (run.status !== 0) return { ok: false, note: `node: exit=${run.status} ${(run.stderr ?? '').slice(0, 300)}`, result: null }
    return { ok: true, note: (run.stderr ?? '').trim(), result: JSON.parse(run.stdout.trim()) as Record<string, unknown> }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('слой хранилища: паритет драйверов', () => {
  it('bun и node отвечают на один сценарий одинаково', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-db-bun-'))
    const underBun = dbScenario(join(dir, 'probe.db'))
    rmSync(dir, { recursive: true, force: true })

    const node = scenarioUnderNode()
    expect(node.note).not.toContain('нет node')
    expect(node.ok).toBe(true)

    // прогон действительно шёл разными драйверами — иначе паритет ничего не значит
    expect(underBun.driver).toBe('bun')
    expect(node.result?.driver).toBe('node')

    const { driver: _b, ...bunRest } = underBun
    const { driver: _n, ...nodeRest } = node.result as Record<string, unknown>
    expect(JSON.parse(JSON.stringify(nodeRest))).toEqual(JSON.parse(JSON.stringify(bunRest)))
  })

  it('загрузка node:sqlite не сорит в stderr — хук обязан молчать', () => {
    const node = scenarioUnderNode()
    expect(node.ok).toBe(true)
    expect(node.note).toBe('')
  })
})

describe('слой хранилища: семантика', () => {
  it('промах .get() — null, а не undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-db-'))
    const db = openDb(join(dir, 'x.db'))
    db.run('CREATE TABLE t(a TEXT)')
    expect(db.query('SELECT * FROM t WHERE a = ?').get('нет')).toBeNull()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('ожидание блокировки выставлено — параллельная запись садовника не съедает подачу', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-db-'))
    const db = openDb(join(dir, 'x.db'))
    expect((db.query('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBeGreaterThan(0)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('readonly не создаёт базу и не пишет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-db-'))
    const path = join(dir, 'ro.db')
    const w = openDb(path)
    w.run('CREATE TABLE t(a TEXT)')
    w.close()

    const ro = openDb(path, { readonly: true })
    expect(() => ro.run("INSERT INTO t VALUES('x')")).toThrow()
    expect((ro.query('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(0)
    ro.close()
    expect(existsSync(path)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('драйвер выбран по рантайму, а не по догадке', () => {
    expect(driverKind()).toBe('bun') // прогон идёт под bun test
  })
})
