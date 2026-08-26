/**
 * Экспорт паспорта в AGENTS.md — знание едет к ДРУГИМ агентам.
 *
 * Зачем. Внутри Claude Code паспорт подаётся живыми каналами (сводка, JIT,
 * гейт) — им экспорт не нужен и даже вреден: статическая копия протухает и
 * дублирует подачу. Но владелец работает не одним инструментом: Codex, Cursor,
 * Copilot читают AGENTS.md (стандарт Linux Foundation) и наших хуков не видят.
 * Экспорт — мост: измеренные законы и карта модулей становятся читаемыми всем.
 *
 * Форма — маркированная секция: всё между BEGIN/END принадлежит Symbiont и
 * перезаписывается при повторном экспорте, остальной файл неприкосновенен
 * (стандартного механизма секций у AGENTS.md нет — маркеры и есть честная
 * конвенция генераторов). Запись в репозиторий владельца — ТОЛЬКО по явной
 * команде, никогда из хука: чужое дерево не трогается молча.
 *
 * Отвергнуто: экспорт зонных правил в .claude/rules (path-scoped) — для самого
 * Claude Code это дублировало бы живую подачу статикой без телеметрии
 * утилизации, а протухшие правила — главная болезнь, от которой умирают
 * memory-инструменты. Живой канал строго лучше своей статической копии.
 */
import { zoneOfArea } from '../miner/facts'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { openDb } from '../core/db'
import { resolveDataRoot, migrateLegacyPassports, stripDataFlag } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { runtimeBlocker } from '../core/runtime'
import { FactStore, factBasis } from '../core/store'
import { initLang, t, statement } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации

const BEGIN = '<!-- BEGIN SYMBIONT PASSPORT (generated — do not edit inside; regenerate with /symbiont:export) -->'
const END = '<!-- END SYMBIONT PASSPORT -->'
const LAWS_MAX = 20
const HABITS_MAX = 10
const MODULES_MAX = 10

const root = process.cwd()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
initLang(dataDir, root)

const blocked = runtimeBlocker()
if (blocked) {
  console.log(blocked)
  process.exit(0)
}

const dbPath = join(dataDir, 'passport.db')
if (!existsSync(dbPath)) {
  console.log(t('Symbiont: паспорта ещё нет — экспортировать нечего. Начните сессию или позовите /symbiont:init.', 'Symbiont: there is no passport yet — nothing to export. Start a session or call /symbiont:init.'))
  process.exit(0)
}

// «Сухой прогон» по слову: показать секцию, ничего не записывая
const arg = stripDataFlag(process.argv.slice(2)).join(' ').trim().toLowerCase()
const dryRun = /^(dry|preview|показать|превью)$/.test(arg)

const db = openDb(dbPath, { readonly: true })
let section = ''
try {
  const store = new FactStore(db)
  const active = store.active()
  const laws = active.filter((f) => f.tier === 'закон' && zoneOfArea(f.area) === null).slice(0, LAWS_MAX)
  const habits = active.filter((f) => f.tier === 'привычка').slice(0, HABITS_MAX)
  let modules: Array<{ file: string; in_deg: number; z1: string | null }> = []
  try {
    modules = db
      .query('SELECT g.file, g.in_deg, s.z1 FROM graph_nodes g LEFT JOIN node_summary s ON s.file = g.file ORDER BY g.rank DESC LIMIT ?')
      .all(MODULES_MAX) as Array<{ file: string; in_deg: number; z1: string | null }>
  } catch {
    // Роли (node_summary) ещё не родились — карта без ролей лучше, чем ничего
    try {
      modules = (
        db.query('SELECT file, in_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?').all(MODULES_MAX) as Array<{
          file: string
          in_deg: number
        }>
      ).map((m) => ({ ...m, z1: null }))
    } catch {
      modules = [] // графа нет вовсе — секция без карты
    }
  }

  if (laws.length === 0 && habits.length === 0 && modules.length === 0) {
    console.log(t('Symbiont: паспорт ещё пуст (нет ни законов, ни карты) — экспорт отложите до первых сессий.', 'Symbiont: the passport is still empty (no laws, no map) — postpone the export until the first sessions.'))
    process.exit(0)
  }

  const lines: string[] = [BEGIN, '']
  lines.push(
    t(
      '## Паспорт проекта (Symbiont)',
      '## Project passport (Symbiont)',
    ),
    '',
    t(
      '_Выведено из кода и истории самого проекта. Числа — измеренная распространённость; «выведено по N образцам» — вывод модели, не замер. Секция генерируется целиком: правки внутри маркеров будут перезаписаны._',
      '_Derived from the project’s own code and history. Numbers are measured prevalence; “inferred from N samples” is a model’s inference, not a measurement. The section is generated as a whole: edits inside the markers will be overwritten._',
    ),
    '',
  )
  if (laws.length > 0) {
    lines.push(t('### Законы (соблюдаются практически всегда)', '### Laws (held virtually always)'), '')
    for (const f of laws) lines.push(`- ${statement(f.statement)} — ${factBasis(f)}`)
    lines.push('')
  }
  if (habits.length > 0) {
    lines.push(t('### Преобладающий стиль (возможны легитимные исключения)', '### Prevailing style (legitimate exceptions possible)'), '')
    for (const f of habits) lines.push(`- ${statement(f.statement)} — ${factBasis(f)}`)
    lines.push('')
  }
  if (modules.length > 0) {
    lines.push(t('### Ключевые модули (по влиянию в графе импортов)', '### Key modules (by influence in the import graph)'), '')
    for (const m of modules) lines.push(`- \`${m.file}\` (${t('вход', 'in')} ${m.in_deg})${m.z1 ? ` — ${m.z1}` : ''}`)
    lines.push('')
  }
  lines.push(END)
  section = lines.join('\n')
} finally {
  db.close()
}

const target = join(root, 'AGENTS.md')
const existing = existsSync(target) ? readFileSync(target, 'utf8') : null

let next: string
if (existing === null) {
  next = `${section}\n`
} else if (existing.includes(BEGIN) && existing.includes(END)) {
  const start = existing.indexOf(BEGIN)
  const end = existing.indexOf(END) + END.length
  next = existing.slice(0, start) + section + existing.slice(end)
} else {
  // Чужой AGENTS.md без нашей секции: дописываемся В КОНЕЦ, ничего не трогая
  next = `${existing.replace(/\s*$/, '')}\n\n${section}\n`
}

if (dryRun) {
  console.log(section)
  console.log(t('\n(сухой прогон — файл не тронут; запись: /symbiont:export)', '\n(dry run — the file was not touched; to write: /symbiont:export)'))
} else {
  writeFileSync(target, next, 'utf8')
  console.log(
    t(
      `Symbiont: секция паспорта записана в AGENTS.md (${existing === null ? 'файл создан' : 'обновлена внутри маркеров, остальное не тронуто'}). Её читают Codex/Cursor/Copilot и другие инструменты; Claude Code получает то же знание живыми каналами. Повторный вызов перегенерирует секцию свежими числами.`,
      `Symbiont: the passport section was written to AGENTS.md (${existing === null ? 'file created' : 'updated inside the markers, the rest untouched'}). Codex/Cursor/Copilot and other tools read it; Claude Code gets the same knowledge through live channels. Calling again regenerates the section with fresh numbers.`,
    ),
  )
}
