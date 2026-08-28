/**
 * Метки владельца: «это правило вводит в заблуждение» — слой поверх журнала.
 * Приглушённое не подаётся и не судится, журнал цел, MCP показывает с пометкой.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { FactStore, keyOf } from '../src/core/store'
import { labelFact, unlabelFact, mutedKeys, matchFacts, readLabels, MISLEADING } from '../src/gardener/labels'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { handleStop } from '../src/hooks/stop-core'
import { callTool } from '../src/mcp/handlers'
import { setLang } from '../src/core/i18n'
import type { Fact } from '../src/miner/facts'

const VAR_LAW: Fact = { area: 'объявления', statement: 'переменные — только var', positive: 60, total: 60, prevalence: 1, tier: 'закон' }
const QUOTE_LAW: Fact = { area: 'форматирование', statement: 'кавычки — одинарные', positive: 50, total: 50, prevalence: 1, tier: 'закон' }

describe('метка поверх журнала', () => {
  it('active() не отдаёт приглушённое, withMuted — отдаёт; журнал цел; метка переживает вытеснение', () => {
    const db = openDb(':memory:')
    const store = new FactStore(db)
    store.assertAll([VAR_LAW, QUOTE_LAW], 'miner:layer0')
    const key = keyOf(VAR_LAW)
    labelFact(db, key, MISLEADING, 'легаси-скрипты', '2026-08-28T00:00:00Z')
    expect(mutedKeys(db)).toEqual(new Set([key]))
    expect(store.active().map((f) => f.statement)).toEqual(['кавычки — одинарные'])
    expect(store.active(Date.now(), true).map((f) => f.statement).sort()).toEqual(['кавычки — одинарные', 'переменные — только var'])
    expect(store.journalSize()).toBe(2) // ни одной записи не тронуто
    // Тот же ключ, новый вердикт — метка на ключе, не на id: приглушено по-прежнему
    store.assertAll([{ ...VAR_LAW, statement: 'переменные — const/let (var не используется)' }], 'miner:layer0')
    expect(store.active().map((f) => f.statement)).toEqual(['кавычки — одинарные'])
    expect(unlabelFact(db, key)).toBe(true)
    expect(unlabelFact(db, key)).toBe(false)
    expect(store.active().length).toBe(2)
    db.close()
  })

  it('без таблицы меток читатели на readonly-базе не падают', () => {
    const db = openDb(':memory:')
    expect(readLabels(db)).toEqual([])
    expect(mutedKeys(db).size).toBe(0)
    db.close()
  })

  it('поиск: точный ключ побеждает подстроку; подстрока — на любом языке подачи; регистр не важен', () => {
    const facts = [
      { key: 'объявления|переменные', statement: 'переменные — только var' },
      { key: 'типы|переменные окружения', statement: 'переменные окружения — через process.env' },
    ]
    expect(matchFacts(facts, 'объявления|переменные').map((f) => f.key)).toEqual(['объявления|переменные'])
    expect(matchFacts(facts, 'ПЕРЕМЕННЫЕ').length).toBe(2)
    expect(matchFacts(facts, 'только var').length).toBe(1)
    expect(matchFacts(facts, '')).toEqual([])
    setLang('en')
    try {
      // английская формулировка рождается на последней миле — искать по ней тоже можно
      expect(matchFacts([{ key: 'k', statement: 'кавычки — одинарные' }], 'single').length).toBe(1)
    } finally {
      setLang('ru')
    }
  })
})

describe('приглушённое правило — во всех каналах разом', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-mute-proj-'))
  const g = (...args: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
  g('init', '-b', 'main')
  const LEGACY = 'function f(_oX) {\n    var sName = _oX.n;\n    var aList = [];\n    for (var i = 0; i < 3; i++) { aList.push(i); }\n    return aList;\n}\n'
  for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
  g('add', '.')
  g('commit', '-m', 'база')
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-mute-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  const first = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'mu-1' }, dataRoot)
  const cli = (...args: string[]) =>
    spawnSync('bun', ['run', join(import.meta.dir, '..', 'src', 'cli', 'mute.ts'), '--data', dataRoot, ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, SYMBIONT_LANG: 'ru' } }).stdout

  it('до метки закон в сводке есть и гейт его ловит', () => {
    expect(first.hookSpecificOutput?.additionalContext ?? '').toContain('только var')
    writeFileSync(join(proj, 'fresh.js'), 'const items = 1\nlet total = 0\n')
    const out = handleStop({ cwd: proj, session_id: 'mu-1' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('только var')
  })

  it('CLI: неоднозначная фраза ничего не глушит; точная — глушит одно, с заметкой', () => {
    const vague = cli('—')
    expect(vague).toMatch(/подходят \d+ правил|активного правила/)
    expect(readLabels(openDb(join(dataDir, 'passport.db'), { readonly: true })).length).toBe(0)
    const done = cli('только var — легаси-скрипты, новый код на const')
    expect(done).toContain('приглушено как вводящее в заблуждение')
    expect(done).toContain('только var')
    const labels = readLabels(openDb(join(dataDir, 'passport.db'), { readonly: true }))
    expect(labels.length).toBe(1)
    expect(labels[0].note).toBe('легаси-скрипты, новый код на const')
    expect(cli('list')).toContain('приглушено владельцем: 1')
  })

  it('после метки: гейт молчит о нём, сводка пересобрана без него и называет число, MCP показывает с пометкой', () => {
    const out = handleStop({ cwd: proj, session_id: 'mu-1' }, dataRoot)
    const gate = out.hookSpecificOutput?.additionalContext ?? ''
    expect(gate).not.toContain('только var')
    const again = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'mu-2' }, dataRoot)
    const ctx = again.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).not.toContain('только var')
    expect(ctx).toContain('приглушено владельцем как вводящее в заблуждение: 1')
    setLang('ru')
    const mcp = callTool('passport_conventions', {}, dataDir, proj)
    expect(mcp).toContain('только var')
    expect(mcp).toContain('⊘ приглушён владельцем')
  })

  it('undo возвращает правило', () => {
    expect(cli('undo только var')).toContain('метка снята')
    const back = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'mu-3' }, dataRoot)
    expect(back.hookSpecificOutput?.additionalContext ?? '').toContain('только var')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
