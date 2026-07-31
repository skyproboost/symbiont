/**
 * CLI /sym-rebuild: пересборка проекций из журнала-истины (лечит любую порчу
 * SUMMARY/графа — дёшево, Salsa делает пересчёт из целых входов).
 *   /sym-rebuild          — мягкая: чистит memo/deps → всё пересобирается заново.
 *   /sym-rebuild --hard   — сброс: журнал АРХИВИРУЕТСЯ (не стирается), БД удаляется,
 *                           паспорт переинициализируется при следующем старте.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { openDb } from '../core/db'
import { resolveDataRoot, migrateLegacyPassports } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { buildPassport } from '../passport/build'

const root = resolve(process.cwd())
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
const dbPath = join(dataDir, 'passport.db')
const hard = process.argv.includes('--hard')

if (!existsSync(dbPath)) {
  console.log('Symbiont: паспорт ещё не построен — пересобирать нечего (соберётся при старте сессии).')
  process.exit(0)
}

if (hard) {
  // Журнал фактов — истина; перед сбросом архивируем (никогда не теряем)
  let archived = 0
  try {
    const db = openDb(dbPath, { readonly: true })
    const rows = db.query('SELECT * FROM fact_journal').all()
    db.close()
    archived = rows.length
    const stampPath = join(dataDir, `journal-archive-${basename(root)}.json`)
    writeFileSync(stampPath, JSON.stringify(rows, null, 2), 'utf8')
    console.log(`Журнал заархивирован: ${archived} записей → ${stampPath}`)
  } catch (e) {
    console.log(`Не удалось прочитать журнал (${String(e).slice(0, 80)}) — сброс отменён ради сохранности истины.`)
    process.exit(1)
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath + suffix, { force: true })
    } catch {
      /* нет файла — ок */
    }
  }
  console.log('Паспорт сброшен. Переинициализируется при следующем старте сессии (история — в архиве выше).')
  process.exit(0)
}

// Мягкая пересборка: чистим кэш Salsa (memo/deps) → все проекции пересчитаются
{
  const db = openDb(dbPath)
  try {
    db.run('DELETE FROM memo')
    db.run('DELETE FROM deps')
  } catch {
    /* нет таблиц Salsa — пересборка всё равно построит */
  } finally {
    db.close()
  }
}
try {
  rmSync(join(dataDir, 'SUMMARY.md'), { force: true }) // заставить перезаписать сводку
} catch {
  /* нет — ок */
}

const t0 = performance.now()
const r = buildPassport(root, dataDir)
const ms = Math.round(performance.now() - t0)
console.log(`Symbiont · пересборка ${basename(root)} · ${ms}мс`)
console.log(`Факты:   ${r.factsExecuted ? 'пересчитаны из истины' : 'из журнала (входы целы)'}`)
console.log(`Граф:    ${r.graphExecuted ? 'пересобран' : 'из журнала'} · узлов ${r.graph.nodeCount} · рёбер ${r.graph.edgeCount}`)
console.log(`Сводка:  ${r.summaryRebuilt ? 'перезаписана' : 'без изменений'} → ${r.summaryPath}`)
console.log(`Журнал:  +${r.journal.born} новых · ${r.journal.updated} уточнено · ${r.journal.superseded} вытеснено`)
