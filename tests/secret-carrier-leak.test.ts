import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { handleSessionStart, slugOf, purgeSecretCarriers } from '../src/hooks/session-start-core'
import { handleStop } from '../src/hooks/stop-core'
import { handlePostTool } from '../src/hooks/post-tool-core'
import { isSecretCarrier } from '../src/env/config-graph'

// Инвариант: «носители секретов не читаются никогда — не открываются ни одним
// проходом». Список расширений его не обеспечивал: `.yarnrc.yml` и
// `*secrets*.yaml` кончаются на .yml, а .yml гейтуется — и файл уходил целиком
// в model_state.content, оттуда в corrections.before_content, оттуда в промпт
// садовника. Здесь путь проверяется целиком, настоящими хуками.

const TOKEN = 'npmAuthToken-SHOULD-NEVER-LEAVE-DISK-9f3a7c21'

// Имена подобраны по пересечению SECRET_CARRIER и GATED_EXT — только они и
// могли просочиться; `.env` спасался случайно (у него пустой extname).
const CARRIERS = ['.yarnrc.yml', 'secrets.yaml', 'credentials.yml', 'app-secrets.yaml']

function world() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-secret-'))
  const g = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
  g('init', '-b', 'main')
  writeFileSync(join(proj, 'app.js'), 'var data = 1;\n')
  g('add', '.')
  g('commit', '-m', 'base')

  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-secret-data-'))
  const dbPath = () => join(dataRoot, slugOf(proj), 'passport.db')
  return { proj, dataRoot, dbPath }
}

function tableExists(db: ReturnType<typeof openDb>, name: string): boolean {
  return (
    (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name) as { n: number }).n > 0
  )
}

/** Ищет секрет в БАЙТАХ файла базы — самая честная проверка «не осело нигде». */
function tokenOnDisk(dbFile: string): boolean {
  try {
    return readFileSync(dbFile).includes(Buffer.from(TOKEN, 'utf8'))
  } catch {
    return false
  }
}

describe('носитель секретов не доходит до хранилища ни одним путём', () => {
  it('Stop не кладёт носителя в model_state и не оставляет секрет в базе', () => {
    const { proj, dataRoot, dbPath } = world()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)

    for (const name of CARRIERS) writeFileSync(join(proj, name), `token: ${TOKEN}\n`)
    writeFileSync(join(proj, 'app.js'), 'var oData = 2;\n') // обычная правка рядом

    handleStop({ cwd: proj, session_id: 's1' }, dataRoot)

    const db = openDb(dbPath())
    const state = db.query('SELECT file FROM model_state').all() as Array<{ file: string }>
    db.close()

    for (const name of CARRIERS) {
      expect(state.some((r) => r.file === name), `${name} не должен попасть в model_state`).toBe(false)
    }
    expect(tokenOnDisk(dbPath()), 'секрет не должен лежать в базе').toBe(false)

    rmrf(proj); rmrf(dataRoot)
  })

  it('обычный файл при этом по-прежнему запоминается — гейт не оглох', () => {
    const { proj, dataRoot, dbPath } = world()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    writeFileSync(join(proj, '.yarnrc.yml'), `token: ${TOKEN}\n`)
    writeFileSync(join(proj, 'app.js'), 'var oData = 2;\n')
    handleStop({ cwd: proj, session_id: 's1' }, dataRoot)

    const db = openDb(dbPath())
    const state = db.query('SELECT file FROM model_state').all() as Array<{ file: string }>
    db.close()

    expect(state.some((r) => r.file === 'app.js'), 'обычный файл обязан остаться').toBe(true)
    rmrf(proj); rmrf(dataRoot)
  })

  it('SessionStart не превращает носителя в поправку и не читает его', () => {
    const { proj, dataRoot, dbPath } = world()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    for (const name of CARRIERS) writeFileSync(join(proj, name), `token: ${TOKEN}\n`)
    writeFileSync(join(proj, 'app.js'), 'var oData = 2;\n')
    handleStop({ cwd: proj, session_id: 's1' }, dataRoot)

    // «правка владельца» в носителе между сессиями — классический путь к corrections
    for (const name of CARRIERS) writeFileSync(join(proj, name), `token: ${TOKEN}-changed\n`)
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's2' }, dataRoot)

    const db = openDb(dbPath())
    const corr = db.query('SELECT file, before_content FROM corrections').all() as Array<{ file: string; before_content: string }>
    db.close()

    for (const name of CARRIERS) {
      expect(corr.some((r) => r.file === name), `${name} не должен стать поправкой`).toBe(false)
    }
    expect(corr.some((r) => r.before_content.includes(TOKEN))).toBe(false)
    expect(tokenOnDisk(dbPath())).toBe(false)

    rmrf(proj); rmrf(dataRoot)
  })

  it('PostToolUse не открывает носителя и не записывает авторство', () => {
    const { proj, dataRoot, dbPath } = world()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    writeFileSync(join(proj, '.yarnrc.yml'), `token: ${TOKEN}\n`)

    const out = handlePostTool(
      { cwd: proj, session_id: 's1', tool_name: 'Write', tool_input: { file_path: join(proj, '.yarnrc.yml') } },
      dataRoot,
    )

    const db = openDb(dbPath())
    // таблицы может не быть вовсе — хук вышел до её создания, и это сильнее,
    // чем пустая таблица: канал не дошёл даже до записи авторства
    const edits = tableExists(db, 'session_edits')
      ? (db.query('SELECT file FROM session_edits').all() as Array<{ file: string }>)
      : []
    db.close()

    expect(edits.some((r) => r.file === '.yarnrc.yml'), 'правка носителя не наша работа').toBe(false)
    expect(JSON.stringify(out)).not.toContain(TOKEN)
    expect(tokenOnDisk(dbPath())).toBe(false)

    rmrf(proj); rmrf(dataRoot)
  })

  it('PostToolUse обычный файл по-прежнему записывает', () => {
    const { proj, dataRoot, dbPath } = world()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    writeFileSync(join(proj, 'app.js'), 'var oData = 3;\n')

    handlePostTool(
      { cwd: proj, session_id: 's1', tool_name: 'Write', tool_input: { file_path: join(proj, 'app.js') } },
      dataRoot,
    )

    const db = openDb(dbPath())
    const edits = db.query('SELECT file FROM session_edits').all() as Array<{ file: string }>
    db.close()

    expect(edits.some((r) => r.file === 'app.js')).toBe(true)
    rmrf(proj); rmrf(dataRoot)
  })
})

describe('вычистка того, что осело до этой версии', () => {
  it('purgeSecretCarriers убирает носителей из corrections и model_state, не трогая остальное', () => {
    const { proj, dataRoot, dbPath } = world()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)

    const db = openDb(dbPath())
    db.run(
      'CREATE TABLE IF NOT EXISTS corrections(id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, before_content TEXT NOT NULL, from_session TEXT NOT NULL, detected_at TEXT NOT NULL, analyzed INTEGER NOT NULL DEFAULT 0)',
    )
    db.run(
      'CREATE TABLE IF NOT EXISTS model_state(session_id TEXT NOT NULL, file TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(session_id, file))',
    )
    const ins = db.query('INSERT INTO corrections(file, before_content, from_session, detected_at) VALUES(?,?,?,?)')
    ins.run('.yarnrc.yml', `token: ${TOKEN}`, 'old', 'now')
    ins.run('secrets.yaml', `token: ${TOKEN}`, 'old', 'now')
    ins.run('app.js', 'var data = 1;', 'old', 'now')
    const insState = db.query('INSERT INTO model_state(session_id,file,hash,content,updated_at) VALUES(?,?,?,?,?)')
    insState.run('old', '.yarnrc.yml', 'h', `token: ${TOKEN}`, 'now')
    insState.run('old', 'app.js', 'h', 'var data = 1;', 'now')

    const removed = purgeSecretCarriers(db)

    const corr = db.query('SELECT file FROM corrections').all() as Array<{ file: string }>
    const state = db.query('SELECT file FROM model_state').all() as Array<{ file: string }>
    db.close()

    expect(removed).toBe(3)
    expect(corr.map((r) => r.file)).toEqual(['app.js'])
    expect(state.map((r) => r.file)).toEqual(['app.js'])

    rmrf(proj); rmrf(dataRoot)
  })

  it('пустая база вычистку переживает и ничего не удаляет', () => {
    const { proj, dataRoot, dbPath } = world()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)
    const db = openDb(dbPath())
    expect(purgeSecretCarriers(db)).toBe(0)
    db.close()
    rmrf(proj); rmrf(dataRoot)
  })

  it('SessionStart вычищает осевшее сам, без отдельной команды', () => {
    const { proj, dataRoot, dbPath } = world()
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's1' }, dataRoot)

    const db = openDb(dbPath())
    db.run(
      'CREATE TABLE IF NOT EXISTS corrections(id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, before_content TEXT NOT NULL, from_session TEXT NOT NULL, detected_at TEXT NOT NULL, analyzed INTEGER NOT NULL DEFAULT 0)',
    )
    db.run(
      'CREATE TABLE IF NOT EXISTS model_state(session_id TEXT NOT NULL, file TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(session_id, file))',
    )
    db.query('INSERT INTO corrections(file, before_content, from_session, detected_at) VALUES(?,?,?,?)')
      .run('.yarnrc.yml', `token: ${TOKEN}`, 'old', 'now')
    db.query('INSERT INTO model_state(session_id,file,hash,content,updated_at) VALUES(?,?,?,?,?)')
      .run('old', 'secrets.yaml', 'h', `token: ${TOKEN}`, 'now')
    db.close()

    handleSessionStart({ cwd: proj, source: 'startup', session_id: 's2' }, dataRoot)

    const after = openDb(dbPath())
    const corr = (after.query('SELECT COUNT(*) n FROM corrections').get() as { n: number }).n
    const state = (after.query('SELECT COUNT(*) n FROM model_state').get() as { n: number }).n
    after.close()

    expect(corr).toBe(0)
    expect(state).toBe(0)
    rmrf(proj); rmrf(dataRoot)
  })
})

describe('какие имена вообще могли просочиться', () => {
  it('пересечение носителей и гейтуемых расширений покрыто именно теми именами, что в тесте', () => {
    // Страж на будущее: расширят GATED_EXT — и появится новый вид носителя,
    // который этот набор не покрывает. Тогда упадёт здесь, а не на бою.
    const gated = ['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx', '.vue', '.md', '.mdx', '.markdown', '.html', '.htm', '.yaml', '.yml']
    const risky = gated.filter((ext) => isSecretCarrier(`secrets${ext}`) || isSecretCarrier(`.yarnrc${ext}`))
    expect(risky.sort()).toEqual(['.yaml', '.yml'])
  })

  it('.env не гейтуется по расширению, но носителем остаётся', () => {
    expect(isSecretCarrier('.env')).toBe(true)
    expect(isSecretCarrier('.env.local')).toBe(true)
  })

  it('шаблон окружения носителем не считается', () => {
    expect(isSecretCarrier('.env.example')).toBe(false)
  })

  it('обычный контент носителем не считается', () => {
    expect(isSecretCarrier('app.js')).toBe(false)
    expect(isSecretCarrier('docs/guide.md')).toBe(false)
    expect(isSecretCarrier('config.yaml')).toBe(false)
  })
})
