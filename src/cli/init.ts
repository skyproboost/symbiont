/**
 * Явная инициализация проекта: «сделай всё сразу и глубоко».
 *
 * Не противоречит удалению команд-отчётов, хотя выглядит похоже. Разница в том,
 * ЧТО команда даёт. Отчёт система знала и без спроса — требовать его набирать
 * было налогом на человека. Здесь наоборот: это СОГЛАСИЕ на дорогую работу
 * прямо сейчас. Фон намеренно растягивает дорогое во времени (кулдауны, бюджет,
 * «дорогое только по триггеру»), потому что не вправе тратить минуты и токены
 * без спроса. Init говорит: я готов подождать.
 *
 * Инвариант: init не делает НИЧЕГО, чего фон не сделал бы сам. Он снимает
 * кулдауны, поднимает бюджет и предзаполняет то, что иначе накапливалось бы
 * визитами. Поэтому не позвать его — не ошибка: проект дозреет сам, медленнее.
 */
import { runtimeBlocker } from '../core/runtime'
import { join, basename, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { openDb } from '../core/db'
import { resolveDataRoot, migrateLegacyPassports, stripDataFlag } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { buildPassport } from '../passport/build'
import { runWorks } from '../gardener/scheduler'
import { WORKS } from '../gardener/works'
import { markVisited } from '../graph/zsummary'
import { initLang, t } from '../core/i18n'

/** Сколько важнейших узлов описать сразу, не дожидаясь, пока их откроют. */
const PRESEED_NODES = 24

/**
 * Повторный вызов не должен стоить как первый. Данные дублировать невозможно
 * (факты вытесняются по ключу, роли не переспрашиваются, снимки latest-wins),
 * но ДОРОГИЕ проходы при снятых кулдаунах побежали бы заново и потратили
 * токены впустую. Поэтому по умолчанию init доинициализирует: делает только
 * то, чего не хватает или что просрочено. Полный пересчёт — по явному слову.
 */
// Слово команды — английское, как и сама команда: смесь «/symbiont:init заново»
// читается как опечатка. Русские синонимы остаются принятыми, но не рекламируются
const FULL_WORDS = /^(re|redo|fresh|full|force|заново|полностью)$/i
const full = FULL_WORDS.test(stripDataFlag(process.argv.slice(2)).join(' ').trim())

const root = resolve(process.cwd())
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
initLang(dataDir, root)

// Предпосылки к окружению — до первой строки работы. Без этого команда уходила
// прямо в openDb и печатала стек ESM-загрузчика вместо объяснения (см. runtime.ts).
const blocked = runtimeBlocker()
if (blocked) {
  console.log(blocked)
  process.exit(0)
}

console.log(t(`Symbiont · инициализация проекта «${basename(root)}»${full ? ' — полный пересчёт' : ''}`, `Symbiont · initialising the project “${basename(root)}”${full ? ' — full recount' : ''}`))
console.log(
  full
    ? t('Все проходы выполняются заново, включая уже сделанные.\n', 'Every pass runs again, including the ones already done.\n')
    : t('Разовый глубокий проход. Уже сделанное не повторяется — «/symbiont:init re» форсирует полный пересчёт.\n', 'A one-off deep pass. Work already done is not repeated — “/symbiont:init re” forces a full recount.\n'),
)

// 1) Паспорт целиком: конвенции, граф, контент-граф, профиль, стадия, каскад зон.
const t0 = performance.now()
const built = buildPassport(root, dataDir)
console.log(
  t(
    `  ✓ паспорт собран за ${Math.round(performance.now() - t0)}мс · узлов ${built.graph.nodeCount} · связей ${built.graph.edgeCount} · фактов +${built.journal.born}`,
    `  ✓ passport built in ${Math.round(performance.now() - t0)}ms · nodes ${built.graph.nodeCount} · links ${built.graph.edgeCount} · facts +${built.journal.born}`,
  ),
)

if (!existsSync(join(dataDir, 'passport.db'))) {
  console.log(t('  ✗ паспорт не создан — дальше идти некуда', '  ✗ the passport was not created — there is nowhere to go from here'))
  process.exit(1)
}

const db = openDb(join(dataDir, 'passport.db'))
try {
  // 2) Предзаполнение ролей. В фоне роли ленивы (описываются только те узлы,
  // которые действительно открывали) — это верно для экономии, но при явной
  // инициализации человек ждёт готовую карту, а не заготовку.
  try {
    const top = db
      .query('SELECT file FROM graph_nodes ORDER BY rank DESC LIMIT ?')
      .all(PRESEED_NODES) as Array<{ file: string }>
    const now = new Date().toISOString()
    for (const n of top) markVisited(db, n.file, now)
    if (top.length > 0) console.log(t(`  ✓ в очередь ролей поставлено ${top.length} важнейших узлов`, `  ✓ ${top.length} most important nodes queued for role descriptions`))
  } catch {
    /* графа нет — контентный проект, ролям неоткуда взяться */
  }

  // 3) Все работы садовника без кулдаунов и с поднятым бюджетом.
  console.log(
    t(
      '  … глубокий проход: разбор кода по синтаксису, неписаные правила, связь настроек с кодом, роли файлов, снимок здоровья\n',
      '  … deep pass: parsing the code by syntax, unwritten rules, how settings govern the code, file roles, a health snapshot\n',
    ),
  )
  const report = await runWorks(WORKS, { db, projectRoot: root, dataDir, nowMs: Date.now() }, { budgetMs: 900_000, ignoreCooldown: full })

  for (const o of report.outcomes) console.log(`  ${o.ok ? '✓' : '✗'} ${o.id.padEnd(12)} ${String(o.ms + t('мс', 'ms')).padEnd(9)} ${o.note}`)
  const quiet = report.skipped.filter((s) => s.includes('нечего')).length
  if (quiet > 0) console.log(t(`  · ${quiet} работ не нашли для себя материала — это норма`, `  · ${quiet} jobs found no material of their own — that is normal`))
  const already = report.skipped.filter((s) => !s.includes('нечего') && !s.includes('бюджет')).length
  if (!full && already > 0) {
    console.log(t(`  · ${already} работ уже сделаны ранее и не повторялись (токены не потрачены) — «/symbiont:init re» форсирует`, `  · ${already} jobs were already done and were not repeated (no tokens spent) — “/symbiont:init re” forces them`))
  }

  console.log(
    t(
      '\nГотово. Паспорт подаётся в каждую сессию сам; дальше система дополняет его по мере работы.',
      '\nDone. The passport is delivered to every session by itself; from here the system fills it in as you work.',
    ),
  )
  console.log(
    t(
      'Посмотреть: /symbiont:status · карта: /symbiont:graph · здоровье проекта: /symbiont:health',
      'See it: /symbiont:status · the map: /symbiont:graph · project health: /symbiont:health',
    ),
  )
} finally {
  db.close()
}
