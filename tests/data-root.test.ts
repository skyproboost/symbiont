import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { resolveDataRoot, migrateLegacyPassports } from '../src/core/data-root'
import { FactStore } from '../src/core/store'
import type { Fact } from '../src/miner/facts'

const NO_ENV = {} as Record<string, string | undefined>

describe('resolveDataRoot', () => {
  it('--data (макрос из hooks.json) — высший приоритет', () => {
    const r = resolveDataRoot('D:\\repo\\.data', ['bun', 'x.ts', '--data', 'D:\\stable'], { CLAUDE_PLUGIN_DATA: 'E:\\env' })
    expect(r.root).toBe('D:\\stable')
    expect(r.mode).toBe('argv')
  })

  it('неподставленный макрос ${CLAUDE_PLUGIN_DATA} в argv игнорируется', () => {
    const r = resolveDataRoot('D:\\repo\\.data', ['bun', 'x.ts', '--data', '${CLAUDE_PLUGIN_DATA}'], NO_ENV)
    expect(r.mode).toBe('dev')
    expect(r.root).toBe('D:\\repo\\.data')
  })

  it('env CLAUDE_PLUGIN_DATA — вторая ступень', () => {
    const r = resolveDataRoot('D:\\repo\\.data', [], { CLAUDE_PLUGIN_DATA: 'E:\\env' })
    expect(r.root).toBe('E:\\env')
    expect(r.mode).toBe('env')
  })

  it('версионированная установка → выведенный стабильный каталог plugins/data/<плагин>-<маркет>', () => {
    const legacy = 'C:\\Users\\u\\.claude\\plugins\\cache\\symbiont-market\\symbiont\\0.14.0\\.data'
    const r = resolveDataRoot(legacy, [], NO_ENV)
    expect(r.mode).toBe('derived')
    expect(r.root).toBe(join('C:\\Users\\u\\.claude\\plugins', 'data', 'symbiont-symbiont-market'))
  })

  it('выведение работает и на unix-путях', () => {
    const legacy = '/home/u/.claude/plugins/cache/m1/plug/1.2.3/.data'
    const r = resolveDataRoot(legacy, [], NO_ENV)
    expect(r.mode).toBe('derived')
    expect(r.root).toBe(join('/home/u/.claude/plugins', 'data', 'plug-m1'))
  })

  it('dev-режим (репозиторий): корень = сама .data, миграции не нужны', () => {
    const r = resolveDataRoot('D:\\OSPanel\\domains\\symbiont\\.data', [], NO_ENV)
    expect(r.mode).toBe('dev')
    expect(r.root).toBe('D:\\OSPanel\\domains\\symbiont\\.data')
    expect(r.legacyRoot).toBe(null)
  })
})

const fact = (statement: string, tier: Fact['tier'] = 'привычка'): Fact => ({
  area: 'стиль',
  statement,
  positive: 5,
  total: 6,
  prevalence: 0.83,
  tier,
})

/** Развернуть фейковую версионированную установку с паспортом проекта. */
function makeVersion(cacheRoot: string, version: string, slug: string, seed: (store: FactStore) => void): void {
  const dir = join(cacheRoot, version, '.data', slug)
  mkdirSync(dir, { recursive: true })
  const db = openDb(join(dir, 'passport.db'))
  seed(new FactStore(db))
  db.close()
}

/** База старой схемы (до v0.14): без колонок rating/deviation/confirmations. */
function makeOldSchemaVersion(cacheRoot: string, version: string, slug: string, rows: Array<[string, string]>): void {
  const dir = join(cacheRoot, version, '.data', slug)
  mkdirSync(dir, { recursive: true })
  const db = openDb(join(dir, 'passport.db'))
  db.run(
    `CREATE TABLE fact_journal(
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, area TEXT NOT NULL,
      statement TEXT NOT NULL, tier TEXT NOT NULL, prevalence REAL NOT NULL,
      positive INTEGER NOT NULL, total INTEGER NOT NULL, source TEXT NOT NULL,
      asserted_at TEXT NOT NULL, seen_at TEXT NOT NULL, superseded_by INTEGER)`,
  )
  for (const [statement, source] of rows) {
    db.query(
      `INSERT INTO fact_journal(key, area, statement, tier, prevalence, positive, total, source, asserted_at, seen_at, superseded_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`,
    ).run(`стиль|${statement.split('—')[0].trim()}`, 'стиль', statement, 'привычка', 0.83, 5, 6, source, '2026-07-29T10:00:00Z', '2026-07-29T10:00:00Z')
  }
  db.close()
}

describe('migrateLegacyPassports', () => {
  it('свежая версия отдаёт каталог целиком, старая доливает НЕперекрытые LLM-факты; идемпотентно', () => {
    const base = mkdtempSync(join(tmpdir(), 'symbiont-mig-'))
    const cacheRoot = join(base, 'plugins', 'cache', 'market', 'plug')
    const stable = join(base, 'plugins', 'data', 'plug-market')

    // 0.13.0: LLM-правило, добытое /sym-learn прошлой версии
    makeVersion(cacheRoot, '0.13.0', 'proj', (s) => {
      s.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:sonnet')
      s.assertAll([fact('отступы — 2 пробела', 'закон')], 'miner:layer0')
    })
    // 0.14.0: свежая установка успела нажить только статистику
    makeVersion(cacheRoot, '0.14.0', 'proj', (s) => {
      s.assertAll([fact('отступы — 2 пробела', 'закон')], 'miner:layer0')
    })
    // до-semver установка по SHA коммита: древнее всех, не должна победить сортировку
    // (живой прогон: parseInt('1313b62…')=1313 обыгрывал 0.14.0)
    makeOldSchemaVersion(cacheRoot, '1313b62dcca1', 'proj', [['var — используется всегда', 'miner:layer0']])

    const res = resolveDataRoot(join(cacheRoot, '0.14.0', '.data'), [], {})
    expect(res.root).toBe(stable)

    const rep = migrateLegacyPassports(res)
    expect(rep.copiedSlugs).toEqual(['proj'])
    expect(rep.mergedLlmFacts).toBe(1)

    const db = openDb(join(stable, 'proj', 'passport.db'), { readonly: true })
    const active = new FactStore(db).active()
    db.close()
    const statements = active.map((f) => f.statement)
    expect(statements).toContain('ошибки — возвращаются значением') // долив из 0.13.0
    expect(statements).toContain('отступы — 2 пробела') // копия из 0.14.0
    expect(statements).not.toContain('var — используется всегда') // SHA-каталог не победил semver
    expect(active.filter((f) => f.statement.startsWith('ошибки')).length).toBe(1)

    // повторный вызов — ноль работы (маркер)
    const rep2 = migrateLegacyPassports(res)
    expect(rep2.copiedSlugs).toEqual([])
    expect(rep2.mergedLlmFacts).toBe(0)
    expect(existsSync(join(stable, '.migrated.json'))).toBe(true)

    rmrf(base)
  })

  it('существующий паспорт в стабильном корне не перезатирается копией', () => {
    const base = mkdtempSync(join(tmpdir(), 'symbiont-mig2-'))
    const cacheRoot = join(base, 'plugins', 'cache', 'market', 'plug')
    const stable = join(base, 'plugins', 'data', 'plug-market')

    // Уже живущий стабильный паспорт
    mkdirSync(join(stable, 'proj'), { recursive: true })
    const db0 = openDb(join(stable, 'proj', 'passport.db'))
    new FactStore(db0).assertAll([fact('кавычки — одинарные', 'закон')], 'miner:layer0')
    db0.close()

    makeVersion(cacheRoot, '0.15.0', 'proj', (s) => {
      s.assertAll([fact('кавычки — двойные', 'закон')], 'miner:layer0')
      s.assertAll([fact('логи — через pino')], 'llm:layer2:opus')
    })

    const res = resolveDataRoot(join(cacheRoot, '0.15.0', '.data'), [], {})
    const rep = migrateLegacyPassports(res)
    expect(rep.copiedSlugs).toEqual([]) // не тронут
    expect(rep.mergedLlmFacts).toBe(1) // но LLM-знание долито

    const db = openDb(join(stable, 'proj', 'passport.db'), { readonly: true })
    const statements = new FactStore(db).active().map((f) => f.statement)
    db.close()
    expect(statements).toContain('кавычки — одинарные') // стабильный вердикт цел
    expect(statements).toContain('логи — через pino')

    rmrf(base)
  })

  it('долив работает и в приёмник со старой схемой (без колонок рейтинга)', () => {
    const base = mkdtempSync(join(tmpdir(), 'symbiont-mig3-'))
    const cacheRoot = join(base, 'plugins', 'cache', 'market', 'plug')
    const stable = join(base, 'plugins', 'data', 'plug-market')

    // старый приёмник уже лежит в стабильном корне (перенесён когда-то давно)
    mkdirSync(stable, { recursive: true })
    makeOldSchemaVersion(join(base, 'tmp-old'), 'x', 'proj', [['отступы — табы', 'miner:layer0']])
    const { cpSync } = require('node:fs') as typeof import('node:fs')
    cpSync(join(base, 'tmp-old', 'x', '.data', 'proj'), join(stable, 'proj'), { recursive: true })

    makeVersion(cacheRoot, '0.14.0', 'proj', (s) => {
      s.assertAll([fact('ошибки — возвращаются значением')], 'llm:layer2:sonnet')
    })

    const res = resolveDataRoot(join(cacheRoot, '0.14.0', '.data'), [], {})
    const rep = migrateLegacyPassports(res)
    expect(rep.mergedLlmFacts).toBe(1) // не молчаливый ноль из-за отсутствия колонок

    const db = openDb(join(stable, 'proj', 'passport.db'), { readonly: true })
    const statements = new FactStore(db).active().map((f) => f.statement)
    db.close()
    expect(statements).toContain('отступы — табы')
    expect(statements).toContain('ошибки — возвращаются значением')

    rmrf(base)
  })

  it('dev-режим: миграция — no-op', () => {
    const rep = migrateLegacyPassports({ root: 'D:\\x\\.data', mode: 'dev', legacyRoot: null })
    expect(rep.copiedSlugs).toEqual([])
    expect(rep.mergedLlmFacts).toBe(0)
  })

  it('НЕ версионированная установка: соседние проекты владельца не считаются «версиями»', () => {
    // Догфудинг-находка: <домены>/<репо>/.data поднимался на два уровня и объявлял
    // версиями плагина ВСЕ соседние проекты — их паспорта уезжали в чужой корень.
    const domains = mkdtempSync(join(tmpdir(), 'symbiont-domains-'))
    makeVersion(domains, 'labreadai-v2', 'labreadai-v2', (s) => {
      s.assertAll([fact('личный боевой проект владельца')], 'llm:layer2:sonnet')
    })
    makeVersion(domains, 'symbiont', 'symbiont', (s) => {
      s.assertAll([fact('отступы — 2 пробела', 'закон')], 'miner:layer0')
    })
    const stable = join(domains, 'stable-root')

    const rep = migrateLegacyPassports({ root: stable, mode: 'derived', legacyRoot: join(domains, 'symbiont', '.data') })

    expect(rep.copiedSlugs).toEqual([])
    expect(existsSync(join(stable, 'labreadai-v2'))).toBe(false)
    rmrf(domains)
  })
})
