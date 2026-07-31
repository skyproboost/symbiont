import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { SessionLog } from '../src/core/sessions'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { handleStop } from '../src/hooks/stop-core'
import { handlePostTool } from '../src/hooks/post-tool-core'

describe('авторство правок: чужая сессия не приписывается своей', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-attr-'))
  const g = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
  g('init', '-b', 'main')
  const LEGACY = 'function f(_oX) {\n    var sName = _oX.n;\n    var aList = [];\n    return aList;\n}\n'
  for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
  g('add', '.')
  g('commit', '-m', 'база')

  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-attr-data-'))
  const dbPath = () => join(dataRoot, slugOf(proj), 'passport.db')
  const stateOf = (sid: string): string[] => {
    const db = openDb(dbPath())
    const rows = db.query('SELECT file FROM model_state WHERE session_id=?').all(sid) as Array<{ file: string }>
    db.close()
    return rows.map((r) => r.file)
  }

  it('две живые сессии в одном дереве: Stop берёт только свои правки', () => {
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'a1' }, dataRoot)
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'a2' }, dataRoot)

    // a1 правит свой файл — PostToolUse фиксирует авторство
    writeFileSync(join(proj, 'mine.js'), 'const mine = 1\n')
    handlePostTool(
      { cwd: proj, session_id: 'a1', tool_name: 'Edit', tool_input: { file_path: join(proj, 'mine.js') } },
      dataRoot,
    )
    // a2 правит свой — для a1 это чужая работа, видимая через общий git status
    writeFileSync(join(proj, 'theirs.js'), 'var theirs = 2\n')

    handleStop({ cwd: proj, session_id: 'a1' }, dataRoot)

    const files = stateOf('a1')
    expect(files).toContain('mine.js')
    expect(files).not.toContain('theirs.js') // раньше попадал сюда и порождал ложную «поправку владельца»
  })

  it('о неразобранном говорится вслух, а не молчанием', () => {
    writeFileSync(join(proj, 'alien.js'), 'var alien = 3\n')
    const out = handleStop({ cwd: proj, session_id: 'a2' }, dataRoot)
    const text = out.hookSpecificOutput?.additionalContext ?? ''
    expect(text).toContain('авторство не подтверждено')
    expect(stateOf('a2')).toEqual([]) // ни одного чужого файла как «модель написала»
  })

  // Регрессия 2026-07-31: строка о неразобранном была единственным наблюдением
  // без дедупа (расфокус и бюджеты рядом дедуплены). additionalContext возвращает
  // ход модели → ход заканчивается → Stop срабатывает снова → ТОТ ЖЕ текст, и так
  // до вмешательства человека. Условие липкое: сосед числится живым, пока его
  // транскрипт молчит меньше 6 ч, — петля жила часами.
  it('о том же неразобранном файле говорится ОДИН раз (иначе Stop зацикливается)', () => {
    const said = (): boolean =>
      (handleStop({ cwd: proj, session_id: 'a2' }, dataRoot).hookSpecificOutput?.additionalContext ?? '')
        .includes('авторство не подтверждено')

    expect(said()).toBe(false) // про alien.js уже сказано в тесте выше — повтора нет

    // Новый чужой файл — это НОВЫЙ факт, о нём сказать обязаны (дедуп по файлу, не «молчи всегда»)
    writeFileSync(join(proj, 'alien2.js'), 'var alien2 = 4\n')
    expect(said()).toBe(true)
    expect(said()).toBe(false) // и снова замолкает
  })

  it('одиночная сессия без записей авторства: прежняя эвристика mtime', () => {
    const db = openDb(dbPath())
    const log = new SessionLog(db)
    log.close('a1', 'test')
    log.close('a2', 'test')
    db.close()

    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'a3' }, dataRoot)
    writeFileSync(join(proj, 'solo.js'), 'var solo = 4\n')
    handleStop({ cwd: proj, session_id: 'a3' }, dataRoot)

    // Соседей нет и авторство подтверждать нечем — правка владельца руками
    // в редакторе должна по-прежнему доходить до гейта и model_state
    expect(stateOf('a3')).toContain('solo.js')
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
