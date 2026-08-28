/**
 * /symbiont:mute — слово владельца о правиле: «это вводит в заблуждение».
 *
 * Метка кладётся поверх журнала (gardener/labels.ts), журнал не правится.
 * Правило ищется по подстроке формулировки на любом языке подачи или по
 * точному ключу; совпадение обязано быть ЕДИНСТВЕННЫМ — приглушить не то
 * правило дороже, чем попросить уточнить. Сводка пересобирается сама на
 * следующем входе (метки входят в хэш журнала), MCP показывает приглушённое
 * с пометкой, гейт его не судит.
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { resolveDataRoot, migrateLegacyPassports, stripDataFlag } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { runtimeBlocker } from '../core/runtime'
import { openDb } from '../core/db'
import { FactStore, factBasis } from '../core/store'
import { readLabels, labelFact, unlabelFact, matchFacts, MISLEADING } from '../gardener/labels'
import { initLang, statement, t } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации

const root = process.cwd()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
const arg = stripDataFlag(process.argv.slice(2)).join(' ').trim()
initLang(dataDir, root)

const blocked = runtimeBlocker()
if (blocked) {
  console.log(blocked)
  process.exit(0)
}

const dbPath = join(dataDir, 'passport.db')
if (!existsSync(dbPath)) {
  console.log(t('Symbiont: паспорт ещё не построен — приглушать нечего.', 'Symbiont: no passport yet — nothing to mute.'))
  process.exit(0)
}

/** Максимум кандидатов при неоднозначном совпадении. */
const AMBIGUOUS_MAX = 8

const LIST = /^(list|список|показать|show)?$/i
const UNDO = /^(undo|отмена|снять|вернуть|unmute)\s+(.+)$/i
/** Разделитель «фраза — заметка владельца»: тире с пробелами по краям. */
const NOTE_SEP = /\s[—–-]{1,2}\s/

const line = (f: { key: string; statement: string; positive: number; total: number; prevalence: number; source: string }): string =>
  `  ${f.key} · ${statement(f.statement)} — ${factBasis(f)}`

const db = openDb(dbPath)
try {
  const store = new FactStore(db)
  if (LIST.test(arg)) {
    const labels = readLabels(db).filter((l) => l.label === MISLEADING)
    if (labels.length === 0) {
      console.log(
        t(
          'Symbiont · приглушённых правил нет. Приглушить: /symbiont:mute <фраза из правила> — оно перестанет подаваться и судиться, история останется.',
          'Symbiont · no muted rules. Mute one: /symbiont:mute <phrase from the rule> — it stops being delivered and enforced, its history stays.',
        ),
      )
      process.exit(0)
    }
    const all = new Map(store.active(Date.now(), true).map((f) => [f.key, f]))
    console.log(t(`Symbiont · приглушено владельцем: ${labels.length}`, `Symbiont · muted by the owner: ${labels.length}`))
    for (const l of labels) {
      const f = all.get(l.key)
      console.log(f ? line(f) : `  ${l.key} · ${t('(в журнале уже нет активной версии)', '(no active version in the journal any more)')}`)
      console.log(`    ${l.at.slice(0, 10)}${l.note ? ` · ${l.note}` : ''} · ${t('вернуть', 'undo')}: /symbiont:mute undo ${l.key}`)
    }
    process.exit(0)
  }

  const undo = arg.match(UNDO)
  if (undo) {
    const phrase = undo[2].trim()
    const muted = new Set(readLabels(db).filter((l) => l.label === MISLEADING).map((l) => l.key))
    const found = matchFacts(store.active(Date.now(), true), phrase).filter((f) => muted.has(f.key))
    if (found.length === 0 && muted.has(phrase)) {
      // Метка на ключе, у которого в журнале уже нет активной версии
      unlabelFact(db, phrase)
      console.log(t(`Symbiont · метка снята: ${phrase}.`, `Symbiont · label removed: ${phrase}.`))
      process.exit(0)
    }
    if (found.length !== 1) {
      console.log(
        found.length === 0
          ? t(`Symbiont · среди приглушённых нет правила с «${phrase}». Список: /symbiont:mute list`, `Symbiont · no muted rule matches “${phrase}”. List: /symbiont:mute list`)
          : t(`Symbiont · под «${phrase}» подходят ${found.length} — уточните:\n${found.slice(0, AMBIGUOUS_MAX).map(line).join('\n')}`, `Symbiont · “${phrase}” matches ${found.length} — be more specific:\n${found.slice(0, AMBIGUOUS_MAX).map(line).join('\n')}`),
      )
      process.exit(0)
    }
    unlabelFact(db, found[0].key)
    console.log(t(`Symbiont · метка снята:\n${line(found[0])}\nПравило снова подаётся со следующего входа.`, `Symbiont · label removed:\n${line(found[0])}\nThe rule is delivered again from the next session start.`))
    process.exit(0)
  }

  // Приглушить: фраза до « — » — искомое, после — заметка владельца (зачем)
  const sep = arg.search(NOTE_SEP)
  const phrase = sep === -1 ? arg : arg.slice(0, sep).trim()
  const note = sep === -1 ? '' : arg.slice(sep).replace(NOTE_SEP, '').trim()
  const found = matchFacts(store.active(), phrase)
  if (found.length === 0) {
    console.log(t(`Symbiont · активного правила с «${phrase}» нет. Формулировки — в passport_conventions.`, `Symbiont · no active rule matches “${phrase}”. Wordings are in passport_conventions.`))
    process.exit(0)
  }
  if (found.length > 1) {
    const rest = found.length > AMBIGUOUS_MAX ? t(`\n  … ещё ${found.length - AMBIGUOUS_MAX}`, `\n  … ${found.length - AMBIGUOUS_MAX} more`) : ''
    console.log(
      t(
        `Symbiont · под «${phrase}» подходят ${found.length} правил — уточните фразу или назовите ключ:\n${found.slice(0, AMBIGUOUS_MAX).map(line).join('\n')}${rest}`,
        `Symbiont · “${phrase}” matches ${found.length} rules — refine the phrase or name the key:\n${found.slice(0, AMBIGUOUS_MAX).map(line).join('\n')}${rest}`,
      ),
    )
    process.exit(0)
  }
  labelFact(db, found[0].key, MISLEADING, note, new Date().toISOString())
  console.log(
    t(
      `Symbiont · приглушено как вводящее в заблуждение:\n${line(found[0])}\nНе подаётся и не судится гейтом со следующего входа; журнал цел. Вернуть: /symbiont:mute undo ${found[0].key}`,
      `Symbiont · muted as misleading:\n${line(found[0])}\nNot delivered and not enforced from the next session start; the journal is intact. Undo: /symbiont:mute undo ${found[0].key}`,
    ),
  )
} finally {
  db.close()
}
