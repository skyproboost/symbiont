import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkAgainstLaws } from '../src/gates/checks'
import { handleStop } from '../src/hooks/stop-core'
import { handleSessionStart } from '../src/hooks/session-start-core'

const LEGACY_LAWS = [
  { statement: 'переменные — только var' },
  { statement: 'стрелочные функции — не используются' },
  { statement: 'filter/map/reduce — не используются (только циклы)' },
  { statement: 'отступы — табы' },
]

describe('checkAgainstLaws', () => {
  it('современный код против легаси-законов: все нарушения пойманы', () => {
    const modern = 'const items = list.map((x) => x.id)\n  let total = 0\n'
    const v = checkAgainstLaws(modern, '.js', LEGACY_LAWS)
    const laws = v.map((x) => x.law)
    expect(laws).toContain('переменные — только var')
    expect(laws).toContain('стрелочные функции — не используются')
    expect(laws).toContain('filter/map/reduce — не используются (только циклы)')
  })

  it('соответствующий код: нарушений нет', () => {
    const legacy = 'function f(_oX) {\n\tvar sName = _oX.n;\n\tfor (var i = 0; i < 3; i++) { }\n\treturn sName;\n}\n'
    expect(checkAgainstLaws(legacy, '.js', LEGACY_LAWS)).toEqual([])
  })

  it('vue-законы: setup против Options и наоборот', () => {
    const setupVue = '<script setup>\nconst x = 1\n</script>'
    const optionsVue = '<script>\nexport default { data() { return {} } }\n</script>'
    expect(checkAgainstLaws(optionsVue, '.vue', [{ statement: 'Vue-компоненты — <script setup>' }])[0]?.detail).toContain('без <script setup>')
    expect(checkAgainstLaws(setupVue, '.vue', [{ statement: 'Vue-компоненты — Options API' }])[0]?.detail).toContain('на <script setup>')
    expect(checkAgainstLaws(setupVue, '.vue', [{ statement: 'Vue-компоненты — <script setup>' }])).toEqual([])
  })

  it('не-JS файлы не проверяются', () => {
    expect(checkAgainstLaws('let x = 1', '.py', LEGACY_LAWS)).toEqual([])
  })
})

describe('handleStop: dry-run гейт на живом git-проекте', () => {
  // легаси-проект с законами + git
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-gate-proj-'))
  const g = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
  g('init', '-b', 'main')
  const LEGACY = 'function f(_oX) {\n    var sName = _oX.n;\n    var aList = [];\n    for (var i = 0; i < 3; i++) { aList.push(i); }\n    return aList;\n}\n'
  for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
  g('add', '.')
  g('commit', '-m', 'база')

  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-gate-data-'))
  handleSessionStart({ cwd: proj, source: 'startup', session_id: 'gs-1' }, dataRoot)

  it('чистое дерево: молчание', () => {
    const out = handleStop({ cwd: proj, session_id: 'gs-1' }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
  })

  it('модель «написала» современный код: dry-run сообщает нарушения', () => {
    writeFileSync(join(proj, 'fresh.js'), 'const items = 1\nlet total = 0\n')
    const out = handleStop({ cwd: proj, session_id: 'gs-1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('dry-run')
    expect(ctx).toContain('не блокировка')
    expect(ctx).toContain('fresh.js')
    expect(ctx).toContain('только var')
    expect(ctx).not.toContain('filter/map/reduce') // этого нарушения ещё нет
  })

  it('дедуп: те же нарушения второй раз не повторяются', () => {
    const out = handleStop({ cwd: proj, session_id: 'gs-1' }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
  })

  it('собранный артефакт не судится законами: он их и не устанавливал', () => {
    // Тот же код, что выше поймали в fresh.js, — но в каталоге сборки. Паспорт
    // объявляет, что сгенерированное не голосует о конвенциях; судить его ими
    // означало бы держать файл перед планкой, которую ему не дали устанавливать,
    // да ещё и без возможности исправиться — следующая сборка перезапишет всё.
    mkdirSync(join(proj, 'dist'), { recursive: true })
    // Каталог обязан быть ОТСЛЕЖИВАЕМЫМ: целиком неотслеживаемый git схлопывает
    // в одну строку «?? dist/», расширения у неё нет, и до гейта файл не дошёл бы
    // вовсе — проверка молчала бы по случайной причине, а не по проверяемой
    writeFileSync(join(proj, 'dist', 'built.js'), LEGACY)
    g('add', 'dist')
    g('commit', '-m', 'артефакт сборки')
    writeFileSync(join(proj, 'dist', 'built.js'), 'const items = 2\nlet total = 1\n')
    const out = handleStop({ cwd: proj, session_id: 'gs-1' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext ?? '').not.toContain('built.js')
  })

  it('новое нарушение в том же файле — сообщается отдельно', () => {
    writeFileSync(join(proj, 'fresh.js'), 'const a = items.filter((x) => x)\n')
    const out = handleStop({ cwd: proj, session_id: 'gs-1' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext).toContain('filter/map/reduce')
  })

  it('файл, изменённый ДО старта сессии, не проверяется', () => {
    writeFileSync(join(proj, 'old-wip.js'), 'const x = 1\n')
    const { utimesSync } = require('node:fs')
    const past = new Date(Date.now() - 48 * 3600_000)
    utimesSync(join(proj, 'old-wip.js'), past, past)
    const out = handleStop({ cwd: proj, session_id: 'gs-2' }, dataRoot)
    // gs-2 не открывалась через SessionStart → fallback 24ч; old-wip старше → молчание
    expect(out.hookSpecificOutput?.additionalContext ?? '').not.toContain('old-wip.js')
  })

  it('HANDOFF-нить: Stop записал файлы сессии, следующая сессия видит нить', () => {
    // gs-1 уже трогал fresh.js в тестах выше → нить записана Stop-ом
    const { openDb } = require('../src/core/db')
    const { slugOf } = require('../src/hooks/session-start-core')
    const db = openDb(join(dataRoot, slugOf(proj), 'passport.db'))
    const t = db.query("SELECT files FROM session_threads WHERE session_id='gs-1'").get()
    db.close()
    expect(JSON.parse(t.files)).toContain('fresh.js')

    const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'gs-next' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('нить прошлой сессии')
    expect(ctx).toContain('fresh.js')
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
