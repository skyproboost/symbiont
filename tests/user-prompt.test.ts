import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promptTokens, handleUserPrompt } from '../src/hooks/user-prompt-core'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'

describe('promptTokens', () => {
  it('вытаскивает файлоподобные токены, режет короткие', () => {
    const t = promptTokens('поправь shared/decode.ts и user-prompt.ts, а ещё x и б')
    expect(t).toContain('shared/decode.ts')
    expect(t).toContain('user-prompt.ts')
    expect(t).not.toContain('x')
  })
})

describe('handleUserPrompt', () => {
  // проект с графом: service и app зависят от utils/core
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-jit-proj-'))
  mkdirSync(join(proj, 'utils'), { recursive: true })
  writeFileSync(join(proj, 'utils', 'core.js'), 'module.exports = { x: 1 };\n')
  writeFileSync(join(proj, 'service.js'), "var core = require('./utils/core');\n")
  writeFileSync(join(proj, 'app.js'), "var svc = require('./service');\n")
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-jit-data-'))
  // паспорт строится SessionStart-ом (как в жизни)
  handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)

  it('упоминание файла → срез графа с зависимыми', () => {
    const out = handleUserPrompt({ prompt: 'что будет если поменять core.js?', cwd: proj, session_id: 's1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('utils/core.js')
    expect(ctx).toContain('вход:1')
    expect(ctx).toContain('зависят: service.js')
  })

  it('дедуп: тот же файл в той же сессии второй раз не подкладывается', () => {
    const out = handleUserPrompt({ prompt: 'ещё про core.js вопрос', cwd: proj, session_id: 's1' }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
  })

  it('другая сессия — подкладывается снова', () => {
    const out = handleUserPrompt({ prompt: 'снова про core.js', cwd: proj, session_id: 's2' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext).toContain('utils/core.js')
  })

  it('мелкий узел: пометки о глубине нет', () => {
    const out = handleUserPrompt({ prompt: 'глянь app.js', cwd: proj, session_id: 's-depth' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext ?? '').not.toContain('глубокого влияния')
  })

  it('промпт без упоминаний файлов → молчание', () => {
    const out = handleUserPrompt({ prompt: 'напиши функцию сортировки массива', cwd: proj, session_id: 's1' }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
  })

  it('имя без расширения тоже матчится', () => {
    const out = handleUserPrompt({ prompt: 'разберись с модулем service пожалуйста', cwd: proj, session_id: 's3' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext).toContain('service.js')
  })

  it('связанные по задаче: PPR подсвечивает импорты упомянутого (направленный лифт)', () => {
    // app.js упомянут; импортирует service.js (→ core.js) — их и подсвечивает
    const out = handleUserPrompt({ prompt: 'правим app.js аккуратно', cwd: proj, session_id: 'ppr1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('связано с задачей')
    expect(ctx).toContain('service.js') // прямой импорт app.js
  })

  it('нет паспорта → молчание, не ошибка', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'symbiont-jit-empty-'))
    const out = handleUserPrompt({ prompt: 'поменять core.js', cwd: proj, session_id: 's1' }, emptyRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
    rmrf(emptyRoot, { recursive: true, force: true })
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
