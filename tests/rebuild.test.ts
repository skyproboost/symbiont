import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { buildPassport } from '../src/passport/build'

describe('механизм /sym-rebuild — очистка memo форсит пересборку из истины', () => {
  it('после очистки memo/deps buildPassport пересчитывает всё заново', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-rb-proj-'))
    mkdirSync(join(proj, 'src'), { recursive: true })
    for (let i = 0; i < 5; i++) writeFileSync(join(proj, 'src', `m${i}.ts`), "const a = 'x'\nconst b = 'y'\n")
    const data = mkdtempSync(join(tmpdir(), 'symbiont-rb-data-'))

    const r1 = buildPassport(proj, data)
    expect(r1.factsExecuted).toBe(true) // первый прогон — пересчёт

    const r2 = buildPassport(proj, data)
    expect(r2.factsExecuted).toBe(false) // второй — из кэша (red-green)

    // Мягкая пересборка: чистим кэш Salsa (как делает /sym-rebuild)
    const db = openDb(join(data, 'passport.db'))
    db.run('DELETE FROM memo')
    db.run('DELETE FROM deps')
    db.close()
    rmSync(join(data, 'SUMMARY.md'), { force: true })

    const r3 = buildPassport(proj, data)
    expect(r3.factsExecuted).toBe(true) // кэш очищен → снова пересчёт из истины
    expect(existsSync(r3.summaryPath)).toBe(true) // сводка восстановлена
    rmrf(proj)
    rmrf(data)
  })

  it('журнал фактов переживает пересборку (истина неприкосновенна)', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-rb2-proj-'))
    mkdirSync(join(proj, 'src'), { recursive: true })
    for (let i = 0; i < 5; i++) writeFileSync(join(proj, 'src', `m${i}.ts`), "const a = 'x'\nconst b = 'y'\n")
    const data = mkdtempSync(join(tmpdir(), 'symbiont-rb2-data-'))
    buildPassport(proj, data)
    const dbPath = join(data, 'passport.db')
    const before = (openDb(dbPath, { readonly: true }).query('SELECT COUNT(*) n FROM fact_journal').get() as { n: number }).n

    const db = openDb(dbPath)
    db.run('DELETE FROM memo')
    db.run('DELETE FROM deps')
    db.close()
    buildPassport(proj, data)
    const after = (openDb(dbPath, { readonly: true }).query('SELECT COUNT(*) n FROM fact_journal').get() as { n: number }).n
    expect(after).toBeGreaterThanOrEqual(before) // журнал не потерян (только дополняется)
    rmrf(proj)
    rmrf(data)
  })
})
