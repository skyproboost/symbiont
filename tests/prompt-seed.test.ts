/**
 * Сид PPR из идентификаторов промпта: владелец называет функцию, а не файл
 * («поправь bumpHeat») — подача обязана найти определяющий файл через индекс
 * символов слоя 1 и притянуть его граф-окружение. Частые имена (определены
 * во многих файлах) сигналом не считаются — та же семантика «единственность
 * или ничего», что у резолва импортов.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { handleUserPrompt } from '../src/hooks/user-prompt-core'
import { slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

/** Мир: граф из трёх узлов, символ warmNode определён в heat.ts, ссылка heat←entry. */
function makeWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-seed-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-seed-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  const db = openDb(join(dataDir, 'passport.db'))
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))')
  const addNode = db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)')
  addNode.run('src/heat.ts', 0.3, 1, 0)
  addNode.run('src/entry.ts', 0.3, 0, 1)
  addNode.run('src/far.ts', 0.3, 0, 0)
  db.query('INSERT INTO graph_edges(from_file,to_file) VALUES(?,?)').run('src/entry.ts', 'src/heat.ts')
  db.run(
    'CREATE TABLE symbols(file TEXT NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, end_line INTEGER NOT NULL, chars INTEGER NOT NULL, PRIMARY KEY(file, ord))',
  )
  const addSym = db.query('INSERT INTO symbols(file,ord,name,kind,line,end_line,chars) VALUES(?,?,?,?,?,?,?)')
  addSym.run('src/heat.ts', 0, 'warmNode', 'function', 1, 10, 200)
  // Частое имя: определено во всех трёх файлах — сигналом быть не должно
  addSym.run('src/heat.ts', 1, 'init', 'function', 11, 12, 20)
  addSym.run('src/entry.ts', 0, 'init', 'function', 1, 2, 20)
  addSym.run('src/far.ts', 0, 'init', 'function', 1, 2, 20)
  db.close()
  writeFileSync(join(proj, 'README.md'), 'x\n')
  return { proj, dataRoot }
}

describe('сид PPR из символов промпта', () => {
  it('упомянутый символ без имени файла тянет граф-окружение определяющего файла', () => {
    const { proj, dataRoot } = makeWorld()
    const out = handleUserPrompt(
      { prompt: 'поправь функцию warmNode чтобы она возвращала null', cwd: proj, session_id: 's1' },
      dataRoot,
    )
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    // basename-матчей нет (файл не назван), но блок «связано с задачей» пришёл
    // и содержит сам определяющий файл или его соседа по рёбрам
    expect(ctx).toContain('src/heat.ts')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('частое имя (определено во многих файлах) сид не образует', () => {
    const { proj, dataRoot } = makeWorld()
    const out = handleUserPrompt(
      { prompt: 'глянь функцию init пожалуйста', cwd: proj, session_id: 's2' },
      dataRoot,
    )
    expect(out.hookSpecificOutput?.additionalContext ?? '').toBe('')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('без индекса символов путь просто молчит (fail-open)', () => {
    const { proj, dataRoot } = makeWorld()
    const dataDir = join(dataRoot, slugOf(proj))
    const db = openDb(join(dataDir, 'passport.db'))
    db.run('DROP TABLE symbols')
    db.close()
    const out = handleUserPrompt(
      { prompt: 'поправь функцию warmNode пожалуйста', cwd: proj, session_id: 's3' },
      dataRoot,
    )
    expect(out.hookSpecificOutput?.additionalContext ?? '').toBe('')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
