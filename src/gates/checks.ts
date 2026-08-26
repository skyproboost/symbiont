/**
 * Гейты формы: проверка файла против законов паспорта (ярус «закон»).
 * Чистые функции, детерминизм; законы сопоставляются по предмету утверждения.
 */
import { analyzeJs, detectIndent } from '../miner/analyze'
import { zoneOfArea } from '../miner/facts'
import { t } from '../core/i18n'

/** Законы, применимые к файлу: глобальные и те зональные, в чьей зоне он лежит. */
export function lawsForFile<L extends { area: string }>(laws: L[], rel: string): L[] {
  const norm = rel.replaceAll('\\', '/')
  return laws.filter((l) => {
    const zone = zoneOfArea(l.area)
    return zone === null || norm.startsWith(`${zone}/`)
  })
}

/** Только глобальные законы — для срезов, где файл не назван (сабагент, экспорт, вербализация). */
export const globalLaws = <L extends { area: string }>(laws: L[]): L[] => laws.filter((l) => zoneOfArea(l.area) === null)

export interface LawLike {
  statement: string
}

export interface Violation {
  law: string
  detail: string
}

const JS_FAMILY = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx', '.vue'])

export function checkAgainstLaws(content: string, ext: string, laws: LawLike[]): Violation[] {
  if (!JS_FAMILY.has(ext)) return []
  const out: Violation[] = []
  const s = analyzeJs(content)
  const indent = detectIndent(content)
  const q = s.quotes
  const quoteVerdict = q.single + q.double < 5 ? null : q.single >= q.double * 2 ? 'single' : q.double >= q.single * 2 ? 'double' : null
  const sm = s.semiLines
  const semiVerdict = sm.with + sm.without < 8 ? null : sm.with >= sm.without * 2 ? 'with' : sm.without >= sm.with * 2 ? 'without' : null

  const add = (law: LawLike, detail: string) => out.push({ law: law.statement, detail })

  for (const law of laws) {
    const st = law.statement
    if (st.includes('переменные — только var')) {
      const n = s.decl.let + s.decl.const
      if (n > 0) add(law, `let/const: ${n}`)
    } else if (st.includes('const/let')) {
      if (s.decl.var > 0) add(law, `var: ${s.decl.var}`)
    } else if (st.includes('стрелочные функции — не используются')) {
      if (s.fn.arrow > 0) add(law, `${t('стрелочных', 'arrow functions')}: ${s.fn.arrow}`)
    } else if (st.includes('filter/map/reduce — не используются')) {
      const n = s.fmr.filter + s.fmr.map + s.fmr.reduce
      if (n > 0) add(law, `filter/map/reduce: ${n}`)
    } else if (st.includes('деструктуризация в параметрах — не используется')) {
      if (s.destructuredParams > 0) add(law, `${t('деструктуризаций в параметрах', 'destructured parameters')}: ${s.destructuredParams}`)
    } else if (st.includes('отступы — табы')) {
      if (indent === 's2' || indent === 's4') add(law, t('отступы пробелами', 'indented with spaces'))
    } else if (st.includes('отступы — 2 пробела')) {
      if (indent === 'tab' || indent === 's4') {
        add(law, indent === 'tab' ? t('отступы табами', 'indented with tabs') : t('отступы 4 пробелами', 'indented with 4 spaces'))
      }
    } else if (st.includes('отступы — 4 пробела')) {
      if (indent === 'tab' || indent === 's2') {
        add(law, indent === 'tab' ? t('отступы табами', 'indented with tabs') : t('отступы 2 пробелами', 'indented with 2 spaces'))
      }
    } else if (st.includes('кавычки — одинарные')) {
      if (quoteVerdict === 'double') add(law, `${t('двойные кавычки', 'double quotes')}: ${q.double}`)
    } else if (st.includes('кавычки — двойные')) {
      if (quoteVerdict === 'single') add(law, `${t('одинарные кавычки', 'single quotes')}: ${q.single}`)
    } else if (st.includes('точки с запятой — используются')) {
      if (semiVerdict === 'without') add(law, `${t('строк без ;', 'lines without ;')}: ${sm.without}`)
    } else if (st.includes('точки с запятой — не используются')) {
      if (semiVerdict === 'with') add(law, `${t('строк с ;', 'lines with ;')}: ${sm.with}`)
    } else if (st.includes('<script setup>')) {
      if (ext === '.vue' && /<script(?![^>]*\bsetup\b)[^>]*>/.test(content)) add(law, t('компонент без <script setup>', 'component without <script setup>'))
    } else if (st.includes('Options API')) {
      if (ext === '.vue' && /<script[^>]*\bsetup\b/.test(content)) add(law, t('компонент на <script setup>', 'component using <script setup>'))
    }
  }
  return out
}
