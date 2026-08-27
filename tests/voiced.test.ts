/**
 * Устные правила владельца: форма правила из набранного текста, авторство по
 * форме строки транскрипта, голос только повтору в разных сессиях.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { ruleSentences, ownerMessages, harvestVoiced, voicedCandidates, renderVoiced, voicedKey, VOICED_MIN_SESSIONS } from '../src/gardener/voiced'
import { upsertConstitution } from '../src/core/constitution'
import { handleStop } from '../src/hooks/stop-core'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

const typed = (content: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra })
const toolResult = (): string => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'Никогда не бросает (fail-open).' }] } })

describe('форма правила', () => {
  it('предписание и запрет ловятся; вопрос, оценка и код — нет', () => {
    const text = [
      'Никогда не трогай прод-оплаты.',
      'Всегда гоняй канарейку перед релизом',
      'Не понимаю, почему это не работает?',
      'Не очень понял третий пункт.',
      '// всегда отвечал бы по-английски',
      'const fail = (msg: string): never => {',
      'Сделай красиво.',
    ].join('\n')
    expect(ruleSentences(text)).toEqual(['Никогда не трогай прод-оплаты.', 'Всегда гоняй канарейку перед релизом'])
  })

  it('ключ повтора не зависит от окончаний и пунктуации', () => {
    expect(voicedKey('Никогда не трогай прод-оплаты!')).toBe(voicedKey('никогда не трогать прод оплату'))
  })
})

describe('авторство по форме строки', () => {
  it('берётся только набранное владельцем: строка, без isMeta, не служебная, человеческой длины', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-voiced-'))
    const p = join(dir, 't.jsonl')
    writeFileSync(
      p,
      [
        typed('Всегда гоняй канарейку перед релизом'),
        toolResult(),
        typed('<command-name>/model</command-name>'),
        typed('Никогда не трогай прод-оплаты', { isMeta: true }),
        typed('Обязательно ' + 'x'.repeat(2100)),
        '{broken',
      ].join('\n'),
    )
    expect(ownerMessages(p)).toEqual(['Всегда гоняй канарейку перед релизом'])
    expect(ownerMessages(join(dir, 'нет.jsonl'))).toEqual([])
    rmrf(dir)
  })
})

describe('голос — только повтору', () => {
  it('одна сессия молчит, две дают кандидата; повторный проход не удваивает; устав исключает', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-voiced-db-'))
    const db = openDb(join(dir, 'p.db'))
    const t1 = join(dir, 'a.jsonl')
    const t2 = join(dir, 'b.jsonl')
    writeFileSync(t1, [typed('Никогда не трогай прод-оплаты.'), typed('Всегда гоняй канарейку')].join('\n'))
    writeFileSync(t2, typed('никогда не трогать прод оплату'))
    expect(harvestVoiced(db, t1, 's1', '2026-01-01T00:00:00Z')).toBe(2)
    expect(harvestVoiced(db, t1, 's1', '2026-01-01T00:00:00Z')).toBe(0) // идемпотентно
    expect(voicedCandidates(db, VOICED_MIN_SESSIONS)).toEqual([])
    expect(harvestVoiced(db, t2, 's2', '2026-01-02T00:00:00Z')).toBe(1)
    const c = voicedCandidates(db, VOICED_MIN_SESSIONS)
    expect(c.length).toBe(1)
    expect(c[0].statement).toBe('Никогда не трогай прод-оплаты.')
    expect(c[0].sessions).toBe(2)
    expect(renderVoiced(c)).toContain('«Никогда не трогай прод-оплаты.» · ×2')
    expect(renderVoiced(c)).toContain('/symbiont:charter')
    expect(voicedCandidates(db, VOICED_MIN_SESSIONS, ['не трогать прод-оплаты'])).toEqual([])
    expect(renderVoiced([])).toBe('')
    db.close()
    rmrf(dir)
  })

  it('пустой базы (таблиц нет) — пусто, не ошибка', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-voiced-empty-'))
    const db = openDb(join(dir, 'p.db'))
    expect(voicedCandidates(db, 2)).toEqual([])
    db.close()
    rmrf(dir)
  })
})

describe('сквозной путь: Stop копит, SessionStart показывает', () => {
  it('правило из двух сессий появляется в сводке и исчезает после внесения в устав', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-voiced-proj-'))
    const g = (...args: string[]) => spawnSync('git', args, { cwd: proj })
    g('init', '-q')
    g('config', 'user.email', 't@t')
    g('config', 'user.name', 't')
    mkdirSync(join(proj, 'src'))
    writeFileSync(join(proj, 'src', 'a.ts'), 'export const a = 1\n')
    g('add', '.')
    g('commit', '-q', '-m', 'база')
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-voiced-data-'))
    const t1 = join(dataRoot, 'a.jsonl')
    const t2 = join(dataRoot, 'b.jsonl')
    writeFileSync(t1, typed('Никогда не трогай прод-оплаты.'))
    writeFileSync(t2, typed('Никогда не трогай прод-оплаты!'))

    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'v-1' }, dataRoot)
    handleStop({ cwd: proj, session_id: 'v-1', transcript_path: t1 }, dataRoot)
    const one = JSON.stringify(handleSessionStart({ cwd: proj, source: 'startup', session_id: 'v-2' }, dataRoot))
    expect(one).not.toContain('Сказано владельцем вслух')
    handleStop({ cwd: proj, session_id: 'v-2', transcript_path: t2 }, dataRoot)
    const two = JSON.stringify(handleSessionStart({ cwd: proj, source: 'startup', session_id: 'v-3' }, dataRoot))
    expect(two).toContain('Сказано владельцем вслух')
    expect(two).toContain('прод-оплаты')

    upsertConstitution(join(dataRoot, slugOf(proj)), [{ goal: 'стабильность оплат', constraint: 'никогда не трогать прод-оплаты' }])
    const recorded = JSON.stringify(handleSessionStart({ cwd: proj, source: 'startup', session_id: 'v-4' }, dataRoot))
    expect(recorded).not.toContain('Сказано владельцем вслух')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
