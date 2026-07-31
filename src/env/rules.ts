/**
 * Выведенные правила контракта среды — то, чего мы не предвидели.
 *
 * Сид против потолка. В `capabilities.ts` лежат несколько правил для холодного
 * старта — они не каталог, а затравка: система обязана работать в проекте, где
 * ещё ничего не выведено. Всё остальное знание о связи «код ↔ конфигурация»
 * ВЫВОДИТСЯ по конфигам конкретного проекта и хранится как факты: стареет,
 * подтверждается, умирает. Иначе список технологий устарел бы раньше, чем был
 * дописан, а случаев бесконечно — вебсокеты, DNS, пиксели, лимиты, права.
 *
 * Почему выводит модель, а не человек: исследование ниши показало, что
 * policy-as-code умер именно на требовании писать правила руками (53%
 * практиков отказываются). Правило, которое нужно написать, не будет написано
 * для случая, о котором никто не подумал.
 *
 * Почему это безопасно: выведенное правило — это ПАТТЕРН ПОИСКА, а не код.
 * Он проходит валидацию (длина, запрет конструкций с катастрофическим
 * бэктрекингом) и применяется только к тексту файлов проекта.
 */
import type { Database } from '../core/db'

export interface ContractRule {
  /** что искать в коде (регулярное выражение как строка) */
  pattern: string
  /** ключ конфигурации, который это регулирует */
  configKey: string
  /** файл конфигурации, где ключ найден */
  configFile: string
  /** значение, которое должно присутствовать, чтобы код работал */
  requires: string
  /** человеческая формулировка требования */
  what: string
  /** модель, которая вывела правило (наблюдаемость происхождения) */
  model: string
}

export function ensureRuleTable(db: Database): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS contract_rule(
       pattern TEXT NOT NULL, config_key TEXT NOT NULL, config_file TEXT NOT NULL,
       requires TEXT NOT NULL, what TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL,
       PRIMARY KEY(pattern, config_key))`,
  )
}

/**
 * Валидация выведенного паттерна. Пропускаем только простые и безопасные
 * выражения: длина ограничена, вложенные квантификаторы запрещены (классический
 * рецепт катастрофического бэктрекинга), выражение обязано компилироваться.
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length < 3 || pattern.length > 120) return false
  if (/(\(\?<|\(\?=|\(\?!)/.test(pattern)) return false // просмотры — лишняя сложность и риск
  if (/(\*|\+|\{\d+,?\d*\})\s*(\*|\+)/.test(pattern)) return false // квантификатор на квантификаторе
  if (/\([^)]*(\*|\+)[^)]*\)\s*(\*|\+)/.test(pattern)) return false // (a+)+ и родня
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

export function storeRules(db: Database, rules: ContractRule[], nowIso = new Date().toISOString()): number {
  ensureRuleTable(db)
  const ins = db.query(
    `INSERT INTO contract_rule(pattern, config_key, config_file, requires, what, model, created_at)
     VALUES(?,?,?,?,?,?,?) ON CONFLICT(pattern, config_key) DO UPDATE SET created_at=excluded.created_at`,
  )
  let stored = 0
  for (const r of rules) {
    if (!isSafePattern(r.pattern)) continue
    ins.run(r.pattern, r.configKey, r.configFile, r.requires, r.what, r.model, nowIso)
    stored++
  }
  return stored
}

export function readRules(db: Database): ContractRule[] {
  try {
    ensureRuleTable(db)
    return (
      db.query('SELECT pattern, config_key, config_file, requires, what, model FROM contract_rule').all() as Array<{
        pattern: string
        config_key: string
        config_file: string
        requires: string
        what: string
        model: string
      }>
    ).map((r) => ({
      pattern: r.pattern,
      configKey: r.config_key,
      configFile: r.config_file,
      requires: r.requires,
      what: r.what,
      model: r.model,
    }))
  } catch {
    return []
  }
}

export interface RuleHit {
  rule: ContractRule
}

/** Применение выведенных правил к тексту файла. Небезопасные не хранятся вовсе. */
export function applyRules(content: string, rules: ContractRule[]): RuleHit[] {
  const out: RuleHit[] = []
  for (const rule of rules) {
    try {
      if (new RegExp(rule.pattern).test(content)) out.push({ rule })
    } catch {
      /* паттерн испортился в хранилище — пропускаем, не роняя проверку */
    }
  }
  return out
}

/**
 * Промпт вывода правил. Модель получает РЕАЛЬНЫЕ конфигурационные ключи этого
 * проекта и отвечает, какой код ими регулируется. Мы не подсказываем ей ни
 * одной технологии: что здесь за стек и что за политики — видно из самих ключей.
 */
export function buildRulesPrompt(entries: Array<{ file: string; key: string; value: string }>): string {
  return [
    'Ниже — реальные настройки конфигурации одного проекта (файл, ключ, значение).',
    '',
    'Задача: определить, какой КОД эти настройки ограничивают или требуют. Нас интересуют только те настройки, которые способны СЛОМАТЬ работающий код в проде, если код потребует того, что настройка не разрешает.',
    '',
    'Пример логики (не копируй его, если в списке нет такого): настройка политики безопасности контента, ограничивающая источники медиа, ломает код, который создаёт объектные URL для видео — браузер заблокирует воспроизведение.',
    '',
    'Настройки проекта:',
    ...entries.slice(0, 60).map((e) => `- ${e.file} · ${e.key} = ${e.value.slice(0, 120)}`),
    '',
    'Ответ — ТОЛЬКО валидный JSON-массив, без пояснений и markdown. Каждый элемент:',
    '{"pattern": "регулярное выражение для поиска такого кода", "configKey": "ключ из списка", "configFile": "файл из списка", "requires": "что должно быть в значении, чтобы код работал", "what": "одной фразой: что делает код и почему настройка его сломает"}',
    '',
    'Требования к pattern: простое выражение до 120 символов, без просмотров вперёд/назад и без вложенных квантификаторов; оно должно находить характерный вызов или конструкцию, а не любое слово.',
    'Возвращай только уверенные правила (максимум 12). Если настройка ничего в коде не ограничивает — не включай её.',
  ].join('\n')
}

/** Строгий разбор ответа: мусор = пусто, небезопасные паттерны отсеиваются. */
export function parseRules(text: string, model: string): ContractRule[] {
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return []
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    const out: ContractRule[] = []
    for (const r of arr) {
      if (typeof r?.pattern !== 'string' || typeof r?.configKey !== 'string') continue
      if (typeof r?.what !== 'string' || r.what.trim().length < 10) continue
      if (!isSafePattern(r.pattern)) continue
      out.push({
        pattern: r.pattern,
        configKey: r.configKey,
        configFile: typeof r.configFile === 'string' ? r.configFile : '(конфигурация проекта)',
        requires: typeof r.requires === 'string' ? r.requires : '',
        what: r.what.trim().slice(0, 200),
        model,
      })
    }
    return out
  } catch {
    return []
  }
}
