/**
 * CLI /sym-drift: дрейф и здоровье паспорта + hotspot-зоны (где копится
 * беспорядок — кандидаты на рефактор). Автоматизирует ручной «периодический
 * рефактор харнесса»: не по расписанию вслепую, а точечно по данным.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../core/db'
import { resolveDataRoot, migrateLegacyPassports } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { computeHealth, computeDrift, computeHotspots, renderDriftReport } from '../gardener/drift'
import { findClones, findNearClones, renderClones } from '../gardener/clones'
import { auditTruth, healProjections, renderTruth } from '../gardener/truth'
import { parseCommitLog } from '../passport/constitution-derive'
import { CODE_EXT, walkFiles, codeFiles } from '../miner/walk'
import { extname, relative } from 'node:path'

const root = resolve(process.cwd())
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
const dbPath = join(dataDir, 'passport.db')

if (!existsSync(dbPath)) {
  console.log('Symbiont: паспорт для этого проекта ещё не построен (строится при старте сессии).')
  process.exit(0)
}

// Здоровье + тренд из паспорта
const db = openDb(dbPath, { readonly: true })
const health = computeHealth(db)
const drift = computeDrift(db)
db.close()

// git-история для hotspot'ов (тот же лог, что и авто-конституция)
const log = (() => {
  try {
    const r = spawnSync('git', ['log', '--name-only', '--pretty=format:@%H%x09%s', '-n', '400'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })
    return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : ''
  } catch {
    return ''
  }
})()
const commits = log ? parseCommitLog(log) : []

// Размер (строки) — только для файлов, тронутых fix/revert-коммитами (не весь репо)
const FIX = /^fix(\(|!|:)|^revert|откат/i
const touched = new Set<string>()
for (const c of commits) if (FIX.test(c.subject.trim())) for (const f of c.files) touched.add(f)
const sizeByFile = new Map<string, number>()
for (const rel of touched) {
  if (!CODE_EXT.has(extname(rel).toLowerCase())) continue // hotspot = код (рефактор), не конфиг/данные/версия
  const abs = join(root, rel)
  try {
    if (statSync(abs).size > 2_000_000) continue
    sizeByFile.set(rel, readFileSync(abs, 'utf8').split('\n').length)
  } catch {
    /* файл удалён — вне hotspot'ов (он уже не болит) */
  }
}

const hotspots = computeHotspots(commits, sizeByFile)
console.log(renderDriftReport(health, drift, hotspots))

// Клоны кода: читаем все код-файлы (on-demand команда, допустимо)
const codeInputs: Array<{ rel: string; content: string }> = []
for (const f of codeFiles(walkFiles(root))) {
  try {
    codeInputs.push({ rel: relative(root, f.path).replaceAll('\\', '/'), content: readFileSync(f.path, 'utf8') })
  } catch {
    /* исчез — пропускаем */
  }
}
const clones = findClones(codeInputs)
const cloneLines = renderClones(clones, findNearClones(codeInputs))
if (cloneLines.length > 0) console.log('\n' + cloneLines.join('\n'))

// Дрейф САМО-ОБРАЗА: врёт ли карта (подаёт ли то, чего нет). Читаем отдельным
// соединением — выше БД открыта readonly, а честный ответ нужен до лечения.
{
  const db = openDb(join(dataDir, 'passport.db'))
  try {
    const issues = auditTruth(db, root, dataDir)
    console.log('\n' + renderTruth(issues))
    if (issues.some((i) => i.healable)) {
      const healed = healProjections(db, root)
      if (healed.removed > 0) console.log(`   вычищено из проекций: ${healed.removed} записей (${[...new Set(healed.tables)].join(', ')}); журнал не тронут`)
    }
  } finally {
    db.close()
  }
}

if (!log) console.log('\n(git-истории нет — зоны частых починок и тренд недоступны; здоровье выше — из паспорта)')
console.log(`\n_Symbiont · ${basename(root)} · «уползло» — против прошлых замеров; «чинят чаще всего» — частота починок × размер файла_`)
