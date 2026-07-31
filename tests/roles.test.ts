import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { rolesFromProfile, isHighStakes, renderTable } from '../src/passport/roles'
import { FactStore } from '../src/core/store'
import { slugOf } from '../src/hooks/session-start-core'
import { handleUserPrompt } from '../src/hooks/user-prompt-core'
import type { Fact } from '../src/miner/facts'

describe('rolesFromProfile', () => {
  it('ось каталога получает свою линзу, неизвестная — общую', () => {
    const roles = rolesFromProfile([
      { statement: 'безопасность — защитные слои: zod' },
      { statement: 'корректность — ось качества здесь (тестов: 22)' },
      { statement: 'экзотическая ось — ось качества здесь (заявлено в доках)' },
    ])
    expect(roles[0].lens).toContain('без проверки')
    expect(roles[1].checks.join(' ')).toContain('тест')
    expect(roles[2].lens).toContain('регресснуть') // общая линза
    expect(roles[2].axis).toBe('экзотическая ось')
  })

  it('рендер: линзы для спора в thinking, без персон-биографий', () => {
    const text = renderTable(rolesFromProfile([{ statement: 'корректность — ось' }]))
    expect(text).toContain('внутреннего спора в размышлении')
    expect(text).toContain('корректность:')
    expect(text.toLowerCase()).not.toContain('сеньор')
    expect(text.toLowerCase()).not.toContain('опытом')
  })
})

describe('isHighStakes', () => {
  it('цена ошибки в промпте распознаётся', () => {
    for (const p of [
      'напиши миграцию для таблицы пользователей',
      'выкати релиз в прод',
      'поправь обработку платежей',
      'смени API-ключ и обнови секреты',
      'настрой CORS для виджета',
    ]) {
      expect(isHighStakes(p)).toBe(true)
    }
  })

  it('обычная работа стол не зовёт', () => {
    for (const p of ['поправь опечатку в README', 'добавь тест на хелпер дат', 'переименуй переменную в utils.ts']) {
      expect(isHighStakes(p)).toBe(false)
    }
  })
})

const profileFact = (statement: string): Fact => ({
  area: 'профиль качества',
  statement,
  positive: 2,
  total: 2,
  prevalence: 1,
  tier: 'привычка',
})

function makeWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-roles-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-roles-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  const db = openDb(join(dataDir, 'passport.db'))
  new FactStore(db).assertAll(
    [profileFact('безопасность — защитные слои: zod'), profileFact('целостность данных — ось качества здесь (prisma)')],
    'miner:profile',
  )
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))')
  db.query('INSERT INTO graph_nodes(file, rank, in_deg, out_deg) VALUES(?,?,?,?)').run('src/pay.ts', 0.4, 3, 1)
  db.close()
  return { proj, dataRoot }
}

describe('симулированный стол в JIT-канале', () => {
  it('high-stakes промпт → линзы из профиля; второй раз за сессию — молчание', () => {
    const { proj, dataRoot } = makeWorld()
    const out = handleUserPrompt({ prompt: 'напиши миграцию для оплат', cwd: proj, session_id: 's1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('стол проекта')
    expect(ctx).toContain('безопасность:')
    expect(ctx).toContain('целостность данных:')
    expect(handleUserPrompt({ prompt: 'продолжай миграцию оплат', cwd: proj, session_id: 's1' }, dataRoot)).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('стол и срез графа совместимы в одном ответе', () => {
    const { proj, dataRoot } = makeWorld()
    const out = handleUserPrompt({ prompt: 'миграция затронет pay.ts — проверь', cwd: proj, session_id: 's2' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('стол проекта')
    expect(ctx).toContain('src/pay.ts · вход:3')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('обычный промпт стола не получает (граф — как раньше)', () => {
    const { proj, dataRoot } = makeWorld()
    const out = handleUserPrompt({ prompt: 'глянь pay.ts', cwd: proj, session_id: 's3' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('src/pay.ts')
    expect(ctx).not.toContain('стол проекта')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('high-stakes без профиля → стол молчит, не ошибка', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-roles-np-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-roles-npd-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const db = openDb(join(dataDir, 'passport.db'))
    db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
    db.close()
    expect(handleUserPrompt({ prompt: 'выкати релиз в прод', cwd: proj, session_id: 's4' }, dataRoot)).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
  })
})
