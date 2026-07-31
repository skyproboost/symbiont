/**
 * Самосозданные верификаторы направления «контент» (CONCEPT §4.1).
 *
 * Прототип — ручной путь лабрида (audit-content.mjs / check-links.mjs), который
 * владелец строил по одному после боли. Symbiont делает возникновение чекеров
 * автоматическим: они активируются касанием файла направления (как плейбуки),
 * исполняются детерминированно и питают гейт (dry-run по умолчанию, блокировка —
 * по gate.json). Ноль LLM-токенов, ноль конфигурации.
 *
 * Универсальные, не требующие калибровки под проект (в отличие от форматных
 * порогов — те редакционная политика; их вывод из корпуса проекта — следующий
 * слой). Чистые функции — тестируются без процесса; резолв ссылок инъектится
 * колбэком (доступ к БД остаётся в хуке).
 */
import type { Database } from '../core/db'
import { pair, t } from '../core/i18n'

/**
 * Имена верификаторов — таблица уровня модуля, как у конвенций майнера.
 *
 * Имя верификатора попадает в журнал поимок и служит там ключом, поэтому в базе
 * оно остаётся русским всегда, а английское рождается на последней миле. Уровень
 * модуля важен ровно по той же причине, что и у фактов: процесс, который только
 * ЧИТАЕТ поимки (отчёт статуса), майнер и верификаторы не зовёт — без загрузки
 * таблицы он показал бы русские имена в английском выводе.
 */
const V = {
  ALPHABET: pair('чистота алфавита (кир/лат микс в слове)', 'alphabet purity (Cyrillic/Latin mix inside a word)'),
  BROKEN: pair('битая внутренняя ссылка', 'broken internal link'),
  ANCHOR_DUP: pair('один анкор на разные цели', 'one anchor pointing to different targets'),
  EMPTY_ANCHOR: pair('ссылка без текста (a11y/SEO)', 'link without text (a11y/SEO)'),
}
import { extractContentLinks, buildResolveIndex, resolveContentTarget, ENTITY_EXT, type Resolution } from '../graph/entities'

export interface VerifierViolation {
  /** имя верификатора — идёт в gate_log как «закон» (единый поток гейта) */
  verifier: string
  detail: string
}

export type ResolveFn = (fromRel: string, target: string) => Resolution

/**
 * Резолвер ссылок над известными сущностями (список rel из entity_nodes).
 * Индекс строится один раз на вызов хука — переиспользуется по всем файлам хода.
 */
export function makeResolver(entityRels: string[]): ResolveFn {
  const index = buildResolveIndex(entityRels)
  return (fromRel, target) => resolveContentTarget(fromRel, target, index)
}

export interface VerifierCtx {
  /** резолв цели ссылки против известных сущностей (строится хуком из entity_nodes) */
  resolve?: ResolveFn
}

/** Верификаторы контента применимы к сущностным расширениям (md/mdx/html/yaml). */
export function contentVerifierActive(ext: string): boolean {
  return ENTITY_EXT.has(ext.toLowerCase())
}

/**
 * Резолвер из БД паспорта (entity_nodes). Нет таблицы (код-проект) или пусто →
 * null: битые ссылки не проверяем (не против чего резолвить), но чистоту
 * алфавита — всё равно. Table-guard, чтобы не бросить на код-проекте.
 */
export function loadEntityResolver(db: Database): ResolveFn | undefined {
  try {
    const has = (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='entity_nodes'").get() as { n: number }).n > 0
    if (!has) return undefined
    const rels = (db.query('SELECT file FROM entity_nodes').all() as Array<{ file: string }>).map((r) => r.file)
    return rels.length > 0 ? makeResolver(rels) : undefined
  } catch {
    return undefined
  }
}

// ── Чистота алфавита (гомоглифы кир/лат) ─────────────────────────────────────

const CYRILLIC = /[Ѐ-ӿ]/
const LATIN = /[A-Za-z]/
// Токен-слово: буквы любого из двух алфавитов (цифры/дефисы внутри допускаем как
// часть слова «ГОСТ-Р», но классифицируем по буквам).
const WORD_RE = /[A-Za-zЀ-ӿ][A-Za-zЀ-ӿ\d]*/g

/**
 * Вырезает то, где смешение алфавитов легитимно/шумно: огороженный код (```),
 * инлайн-код (`…`) и URL. Гомоглиф в прозе — почти всегда опечатка/подмена;
 * в примере кода — другой разговор, не тревожим (анти-шум).
 */
function stripNonProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[\w.-]+\/[\w./-]+/g, ' ') // пути/слаги
}

/** Токены, в которых СМЕШАНЫ кириллица и латиница (классический гомоглиф). */
export function mixedScriptTokens(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of stripNonProse(text).matchAll(WORD_RE)) {
    const tok = m[0]
    if (CYRILLIC.test(tok) && LATIN.test(tok) && !seen.has(tok)) {
      seen.add(tok)
      out.push(tok)
    }
  }
  return out
}

const MAX_EXAMPLES = 5

export function checkAlphabetPurity(content: string): VerifierViolation[] {
  const bad = mixedScriptTokens(content)
  if (bad.length === 0) return []
  const examples = bad.slice(0, MAX_EXAMPLES).map((t) => `«${t}»`).join(', ')
  return [
    {
      verifier: V.ALPHABET,
      detail: `${bad.length} слов со смешением алфавитов: ${examples}${bad.length > MAX_EXAMPLES ? ' …' : ''}`,
    },
  ]
}

// ── Целостность ссылок (битые внутренние, дубли/пустые анкоры) ────────────────

export function checkContentLinks(rel: string, content: string, ext: string, resolve?: ResolveFn): VerifierViolation[] {
  const links = extractContentLinks(ext, content)
  const broken: string[] = []
  const emptyAnchors: string[] = []
  const anchorTargets = new Map<string, Set<string>>()

  for (const link of links) {
    if (!link.explicit) continue // мягкие yaml-значения — данные, не заявка на навигацию
    if (link.anchor.length === 0) {
      if (emptyAnchors.length < MAX_EXAMPLES) emptyAnchors.push(link.target)
      continue
    }
    if (resolve) {
      const res = resolve(rel, link.target)
      if (res.kind === 'broken') {
        broken.push(link.target)
        continue
      }
      if (res.kind === 'entity') {
        const set = anchorTargets.get(link.anchor) ?? new Set<string>()
        set.add(res.rel)
        anchorTargets.set(link.anchor, set)
      }
    }
  }

  const out: VerifierViolation[] = []
  if (broken.length > 0) {
    out.push({
      verifier: V.BROKEN,
      detail: `${broken.length}: ${broken.slice(0, MAX_EXAMPLES).map((t) => `→ ${t}`).join(', ')}${broken.length > MAX_EXAMPLES ? ' …' : ''}`,
    })
  }
  // Параметры переименованы из pair: имя занято таблицей формулировок выше
  const dup = [...anchorTargets.entries()].filter((entry) => entry[1].size >= 2)
  if (dup.length > 0) {
    out.push({
      verifier: V.ANCHOR_DUP,
      detail: dup.slice(0, MAX_EXAMPLES).map((entry) => `«${entry[0]}» → ${entry[1].size} ${t('целей', 'targets')}`).join(', '),
    })
  }
  if (emptyAnchors.length > 0) {
    out.push({
      verifier: V.EMPTY_ANCHOR,
      detail: `${emptyAnchors.length}: ${emptyAnchors.map((t) => `→ ${t}`).join(', ')}`,
    })
  }
  return out
}

/** Все верификаторы контента для одного файла. */
export function runContentVerifiers(rel: string, content: string, ext: string, ctx: VerifierCtx = {}): VerifierViolation[] {
  if (!contentVerifierActive(ext)) return []
  return [...checkAlphabetPurity(content), ...checkContentLinks(rel, content, ext, ctx.resolve)]
}
