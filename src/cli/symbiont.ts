/**
 * Общий исполнитель наблюдательных команд Symbiont.
 *
 * Прежние пять отчётных команд удалены: их работа ушла в фон, потому что
 * команда, о которой надо помнить, — налог на человека. Осталось наблюдение для
 * случая, когда человек САМ пришёл посмотреть; работу оно не запускает (её
 * делает садовник), а читает уже посчитанное, и потому дёшево.
 *
 * Скиллы — тонкие обёртки над этим файлом, режим приходит первым аргументом:
 *   (пусто)    — /symbiont:status — паспорт, петля, граф, фон, окупаемость;
 *   graph      — /symbiont:graph  — интерактивная карта одним HTML-файлом;
 *   health     — /symbiont:health — дрейф, hotspot-зоны, честность паспорта;
 *   <зона>     — /symbiont:status <путь> — карта зоны с ролями узлов.
 */
import { join, basename } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { openDb } from '../core/db'
import { resolveDataRoot, migrateLegacyPassports, stripDataFlag } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { buildStatusReport, buildMapReport } from './reports'
import { computeHealth, computeDrift, renderDriftReport, hotspotsFromGit } from '../gardener/drift'
import { auditTruth, renderTruth } from '../gardener/truth'
import { rankKinds, renderUtility } from '../gardener/utility'
import { lastRun, REPORTED_WORKS } from '../gardener/scheduler'
import { collectGraphData, renderGraphHtml } from './graph-html'
import { runtimeBlocker, silentSpawnOptions, fileOpener } from '../core/runtime'
import { initLang, t } from '../core/i18n'

/**
 * Открыть готовую карту в браузере по умолчанию.
 *
 * На Windows намеренно НЕ используется `cmd /c start`: cmd — консольная
 * программа, и её запуск мелькает чёрным окном на экране владельца. Плагин не
 * вправе показывать окна: он работает молча и в фоне. explorer решает ту же
 * задачу (открыть файл ассоциированным приложением), но это GUI-программа, и
 * консоли она не создаёт. Плата: explorer всегда возвращает ненулевой код, так
 * что судить по нему об успехе нельзя — и не нужно, путь напечатан рядом.
 */
function openInBrowser(file: string): boolean {
  try {
    const { spawn } = require('node:child_process') as typeof import('node:child_process')
    const opts = silentSpawnOptions()
    const p =
      process.platform === 'win32'
        ? spawn('explorer.exe', [file.replaceAll('/', '\\')], opts)
        : process.platform === 'darwin'
          ? spawn('open', [file], opts)
          : spawn('xdg-open', [file], opts)
    p.on('error', () => {
      /* нечем открывать — путь напечатан выше */
    })
    p.unref()
    return true
  } catch {
    return false
  }
}

const root = process.cwd()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
const arg = stripDataFlag(process.argv.slice(2)).join(' ').trim()
initLang(dataDir, root)

// Предпосылки к окружению — до первой строки работы. Без этого команда уходила
// прямо в openDb и печатала стек ESM-загрузчика вместо объяснения (см. runtime.ts).
const blocked = runtimeBlocker()
if (blocked) {
  console.log(blocked)
  process.exit(0)
}

// Язык подачи сюда больше не относится: у него своя команда (/symbiont:lang).
// Спрятанный в аргументах обзора, он не находился — человек, которому плагин
// отвечает не на том языке, ищет команду про язык, а не описание команды про
// состояние паспорта. Слово «lang» здесь перехватывается только затем, чтобы
// не молчать в ответ на прежнюю форму вызова.
const LANG_WORDS = /^(язык|lang|language)\b/i
if (LANG_WORDS.test(arg)) {
  console.log(t('Symbiont: язык подачи теперь отдельной командой — /symbiont:lang (без аргумента покажет текущий).', 'Symbiont: the output language now has its own command — /symbiont:lang (no argument shows the current one).'))
  process.exit(0)
}

if (!existsSync(join(dataDir, 'passport.db'))) {
  console.log(t('Symbiont: паспорт ещё не построен — соберётся сам при старте сессии в этом проекте.', 'Symbiont: no passport yet — it builds itself when a session starts in this project.'))
  process.exit(0)
}

const HEALTH_WORDS = /^(здоровье|health|дрейф|drift)$/i
const GRAPH_WORDS = /^(граф|карта|graph|map|html)(?:\s+(.+))?$/i

// Интерактивная карта: граф в терминале читается как «волосяной шар», а человеку
// нужно смотреть и тянуть узлы. Один самодостаточный файл, ноль внешних запросов.
// Вторым словом можно назвать каталог — тогда рисуется только эта часть проекта:
// на большом репозитории карта целиком читается хуже, чем карта своей зоны.
const graphArg = arg.match(GRAPH_WORDS)
if (graphArg) {
  const zone = (graphArg[2] ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '') || null
  const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
  try {
    const one = (sql: string): number => {
      try {
        return (db.query(sql).get() as { n: number }).n
      } catch {
        return 0
      }
    }
    const nodes = zone
      ? (db.query('SELECT COUNT(*) n FROM graph_nodes WHERE file LIKE ?').get(`${zone}%`) as { n: number }).n
      : one('SELECT COUNT(*) n FROM graph_nodes')
    if (nodes === 0) {
      console.log(
        zone
          ? t(`Symbiont: в каталоге «${zone}» узлов графа нет — проверьте путь (список зон покажет /symbiont:status).`, `Symbiont: no graph nodes under “${zone}” — check the path (/symbiont:status lists the areas).`)
          : t('Symbiont: граф пуст (нет внутренних импортов) — рисовать нечего.', 'Symbiont: the graph is empty (no internal imports) — nothing to draw.'),
      )
      process.exit(0)
    }
    const stats: Record<string, string> = {
      'узлов в графе': String(nodes),
      'связей': String(one('SELECT COUNT(*) n FROM graph_edges')),
      'фактов живо': String(one('SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL')),
      'из них законов': String(one("SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL AND tier='закон'")),
      'ролей выведено': String(one('SELECT COUNT(*) n FROM node_summary')),
      'поимок гейта': String(one('SELECT COUNT(*) n FROM gate_log')),
    }
    const html = renderGraphHtml(collectGraphData(db, zone ? `${basename(root)} · ${zone}` : basename(root), stats, zone))
    const out = join(dataDir, zone ? `graph-${zone.replaceAll('/', '-')}.html` : 'graph.html')
    writeFileSync(out, html, 'utf8')
    console.log(t(`Symbiont · интерактивная карта${zone ? ` каталога ${zone}` : ''}: ${nodes} узлов`, `Symbiont · interactive map${zone ? ` of ${zone}` : ''}: ${nodes} nodes`))
    console.log(`\n  ${out}\n`)
    const opened = openInBrowser(out)
    console.log(
      opened
        ? t('Открывается в браузере: тяните узлы мышью, колесо — зум, клик — детали узла, двойной клик — фокус на окружении.', 'Opening in your browser — drag nodes, wheel to zoom, click for node details, double-click to focus on its surroundings.')
        : t('Откройте файл в браузере: тяните узлы мышью, колесо — зум, клик — детали узла, двойной клик — фокус на окружении.', 'Open the file in a browser — drag nodes, wheel to zoom, click for node details, double-click to focus on its surroundings.'),
    )
    console.log(t('_один файл, ноль внешних запросов; в нём только пути и связи, ни строки кода проекта_', '_one file, zero external requests; it holds paths and links only, not a line of your code_'))
  } finally {
    db.close()
  }
  process.exit(0)
}

if (arg && !HEALTH_WORDS.test(arg)) {
  console.log(buildMapReport(dataDir, arg))
  process.exit(0)
}

const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
try {
  if (HEALTH_WORDS.test(arg)) {
    // Hotspot-зоны считаются здесь ЖИВЬЁМ, а не подставляются пустым списком:
    // иначе обзор (показывающий заметку фона) и здоровье говорили бы об одном
    // и том же разное — «hotspot: data-root.ts» против «hotspot-ов нет».
    console.log(renderDriftReport(computeHealth(db), computeDrift(db), hotspotsFromGit(root)))
    console.log('\n' + renderTruth(auditTruth(db, root, dataDir)))
    console.log(
      '\n' +
        t(
          '_куда всё ползёт относительно прошлых замеров; выправляется фоном само, команда лишь показывает_',
          '_where things are drifting relative to earlier snapshots; the background fixes it by itself, the command only shows_',
        ),
    )
  } else {
    console.log(buildStatusReport(dataDir))
    // Что делает фон вместо удалённых команд — видно здесь же
    const bg = REPORTED_WORKS.map((id) => ({ id, last: lastRun(db, id) })).filter((r) => r.last !== null)
    if (bg.length > 0) {
      console.log(' ' + t('Фоновая работа (идёт сама, команд не требует)', 'Background work (runs on its own, needs no commands)'))
      for (const r of bg) {
        const ageH = Math.round((Date.now() - Date.parse(r.last!.at)) / 3_600_000)
        const age =
          ageH < 1
            ? t('меньше часа назад', 'less than an hour ago')
            : ageH < 48
              ? t(`${ageH}ч назад`, `${ageH}h ago`)
              : t(`${Math.round(ageH / 24)}д назад`, `${Math.round(ageH / 24)}d ago`)
        console.log(`   ${r.id.padEnd(12)}${r.last!.ok ? ' ' : '⚠'} ${age} · ${r.last!.note}`)
      }
      console.log('')
    }
    const util = renderUtility(rankKinds(db))
    if (util) console.log(` ${util}\n`)
    console.log(
      t(
        '_смежное: /symbiont:graph — интерактивная карта · /symbiont:health — что уползло и можно ли верить паспорту_',
        '_nearby: /symbiont:graph — the interactive map · /symbiont:health — what drifted and whether the passport can be trusted_',
      ),
    )
  }
} finally {
  db.close()
}
