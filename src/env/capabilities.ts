/**
 * Требования кода к среде — половина «контракта среды» (docs/environment-contract.md).
 *
 * Идея, которой у графа не было: код связан не только с кодом. Он ТРЕБУЕТ
 * что-то от среды — создать blob-URL, открыть воркер, сходить на домен,
 * прочитать переменную окружения, — и эти требования не записаны ни в одном
 * импорте. Пока их никто не извлекает, противоречие с политикой проекта
 * (CSP, объявленные сервисы, .env) вскрывается только в проде.
 *
 * Каталог — ДАННЫЕ, а не логика: новое требование добавляется записью, механизм
 * не меняется (тот же приём, что у signals.ts). Извлечение детерминированное,
 * без LLM: регэкспы по исходнику, кросс-язык там, где конструкция одинакова.
 */

/** Вид политики, которая может это требование разрешить или запретить. */
export type PolicyKind = 'csp' | 'env' | 'service'

export interface CapabilityRule {
  /** машинное имя требования — оно же связывает с политикой */
  id: string
  /** какой политикой регулируется */
  policy: PolicyKind
  /** для CSP — директива, которой требование адресуется */
  directive?: string
  /** что именно должно быть разрешено (источник CSP: blob:, data:, домен) */
  source?: string
  /** человеческое объяснение — идёт в вывод, поэтому пишется как факт */
  what: string
  match: RegExp
}

/**
 * СИД, А НЕ ПОТОЛОК. Эти правила существуют ради холодного старта: в проекте,
 * где ещё ничего не выведено, слой обязан приносить пользу с первой минуты.
 * Основное знание о связях «код ↔ конфигурация» ВЫВОДИТСЯ по конфигам самого
 * проекта (src/env/rules.ts) и живёт фактами — иначе этот список пришлось бы
 * бесконечно догонять новыми технологиями, а случаев бесконечно много.
 *
 * Здесь только то, что (а) ломается в проде повсеместно и (б) распознаётся без
 * ложных срабатываний. Расширять руками — последнее средство, а не первое.
 */
export const CAPABILITIES: CapabilityRule[] = [
  {
    id: 'blob-url',
    policy: 'csp',
    directive: 'media-src',
    source: 'blob:',
    what: 'код создаёт blob:-URL (например для видео или скачивания файла)',
    match: /URL\.createObjectURL\s*\(|new\s+Blob\s*\(/,
  },
  {
    id: 'media-stream',
    policy: 'csp',
    directive: 'media-src',
    source: 'blob:',
    what: 'код собирает видеопоток (MediaRecorder / captureStream)',
    match: /new\s+MediaRecorder\s*\(|\.captureStream\s*\(|new\s+MediaSource\s*\(/,
  },
  {
    id: 'worker',
    policy: 'csp',
    directive: 'worker-src',
    source: 'blob:',
    what: 'код запускает Worker',
    match: /new\s+(Shared)?Worker\s*\(/,
  },
  {
    id: 'websocket',
    policy: 'csp',
    directive: 'connect-src',
    source: 'wss:',
    what: 'код открывает WebSocket-соединение',
    match: /new\s+WebSocket\s*\(|io\s*\(\s*['"`]wss?:/,
  },
  {
    id: 'eval',
    policy: 'csp',
    directive: 'script-src',
    source: "'unsafe-eval'",
    what: 'код исполняет строку как код (eval / new Function)',
    match: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    id: 'inline-style',
    policy: 'csp',
    directive: 'style-src',
    source: "'unsafe-inline'",
    what: 'код задаёт инлайновые стили через style-атрибут',
    match: /\.style\.cssText\s*=|setAttribute\s*\(\s*['"`]style['"`]/,
  },
  {
    id: 'data-image',
    policy: 'csp',
    directive: 'img-src',
    source: 'data:',
    what: 'код формирует изображение как data:-URL (canvas.toDataURL)',
    match: /toDataURL\s*\(|['"`]data:image\//,
  },
]

export interface CapabilityHit {
  rule: CapabilityRule
  /** внешний домен, если требование адресуется конкретному адресу */
  target: string | null
}

/** Внешние адреса, к которым обращается код: их регулирует connect-src / CORS. */
// Захватывается ХОСТ без схемы: политика говорит о хосте, а не об URL целиком
const REMOTE_CALL = /(?:fetch|axios(?:\.\w+)?|\.get|\.post)\s*\(\s*['"`]https?:\/\/([^/'"`]+)/g

/**
 * Требования одного файла. Комментарии и строки не вычищаются намеренно:
 * упоминание `blob:` в комментарии почти всегда сопровождает реальный код, а
 * попытка отличить одно от другого регэкспом даёт больше вреда, чем пользы.
 */
export function extractCapabilities(content: string): CapabilityHit[] {
  const out: CapabilityHit[] = []
  for (const rule of CAPABILITIES) {
    if (rule.match.test(content)) out.push({ rule, target: null })
  }
  const seen = new Set<string>()
  for (const m of content.matchAll(REMOTE_CALL)) {
    const host = m[1].toLowerCase()
    if (seen.has(host)) continue
    seen.add(host)
    out.push({
      rule: {
        id: 'remote-call',
        policy: 'csp',
        directive: 'connect-src',
        source: host,
        what: `код обращается к внешнему адресу ${host}`,
        match: REMOTE_CALL,
      },
      target: host,
    })
  }
  return out
}

/** Переменные окружения, которые код реально читает (кросс-язык). */
export function extractEnvUsage(content: string): string[] {
  const out = new Set<string>()
  for (const m of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) out.add(m[1])
  for (const m of content.matchAll(/process\.env\[['"`]([A-Z][A-Z0-9_]{2,})['"`]\]/g)) out.add(m[1])
  for (const m of content.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]{2,})/g)) out.add(m[1])
  for (const m of content.matchAll(/os\.environ(?:\.get)?\[?\(?['"`]([A-Z][A-Z0-9_]{2,})['"`]/g)) out.add(m[1])
  for (const m of content.matchAll(/getenv\s*\(\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]/g)) out.add(m[1])
  return [...out]
}
