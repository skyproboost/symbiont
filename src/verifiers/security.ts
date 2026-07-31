/**
 * Страж защитных слоёв (CONCEPT §4.1 security): «ни одна правка не может МОЛЧА
 * ослабить защиту — снять заголовок, расширить CORS, обойти валидацию». Это
 * названный приоритет (безопасность — единственная ось, присутствующая всегда) и
 * самый ценный, наименее шумный элемент стража фокуса (долг №7).
 *
 * Работает по git-диффу изменённого файла: смотрит УДАЛЁННЫЕ строки на признаки
 * защиты и ДОБАВЛЕННЫЕ — на признаки риска. Срабатывает только на реальном
 * ослаблении → низкий шум (в отличие от «вы тронули много файлов»). Паттерны —
 * кросс-язык (заголовки/CORS/eval/TLS-verify одинаковы в JS/Py/PHP/Go/…),
 * заземлены на OWASP Top-10 и security-плейбуки репозитория. Ноль LLM-токенов.
 *
 * Дизайн-компромисс: это ЭВРИСТИКА, не доказательство. Ложное срабатывание
 * возможно (рефактор перенёс защиту в другое место того же диффа) — поэтому
 * дефолт dry-run (сообщаем фактом), а не блок; «намеренно — скажи владельцу».
 */

export interface SecurityFinding {
  kind: string
  detail: string
}

interface Rule {
  kind: string
  re: RegExp
  /** true — искать в УДАЛЁННЫХ строках (защита снята); false — в ДОБАВЛЕННЫХ (риск внесён) */
  onRemoval: boolean
}

// Защита СНЯТА (удалённые строки). Кросс-язык.
const REMOVAL_RULES: Rule[] = [
  // .parse( убран как слишком широкий (ловил marked.parse/JSON.parse/Date.parse —
  // догфудинг-находка); .safeParse( zod-специфичен, schema.parse ловим через schema-контекст
  { kind: 'снята валидация входа', onRemoval: true, re: /(zod|joi|yup|validator|express-validator|\.safeParse\(|[\w$]*schema[\w$]*\.parse\(|pydantic|BaseModel|is_valid\(|\.clean\(|validate\w*\(|sanitiz)/i },
  { kind: 'снята аутентификация/авторизация', onRemoval: true, re: /\b(requireAuth|isAuthenticated|ensureLoggedIn|login_required|authorize\(|authenticate\(|verifyToken|jwt\.verify|checkPermission|@auth|hasRole|can\()/i },
  { kind: 'снят security-заголовок', onRemoval: true, re: /(Content-Security-Policy|Strict-Transport-Security|X-Frame-Options|X-Content-Type-Options|Referrer-Policy|Permissions-Policy|helmet\(|frameguard|hsts\()/i },
  { kind: 'снят rate-limit', onRemoval: true, re: /\b(rateLimit|express-rate-limit|limiter|limit_req|RateLimiter|throttle|slowDown)\b/i },
  { kind: 'снято экранирование/санитизация', onRemoval: true, re: /\b(escapeHtml|escape\(|DOMPurify|sanitizeHtml|htmlspecialchars|bleach\.|escape_string|quote\()/i },
  { kind: 'снята защита от CSRF', onRemoval: true, re: /\b(csrf|csurf|CSRFProtect|xsrf)\b/i },
]

// Риск ВНЕСЁН (добавленные строки).
const ADDITION_RULES: Rule[] = [
  { kind: 'CORS расширен до «*»', onRemoval: false, re: /(Access-Control-Allow-Origin['"]?[\s:,]*['"]?\*|origin\s*:\s*['"]\*['"]|cors\(\s*\)|credentials\s*:\s*true[\s\S]{0,40}origin\s*:\s*['"]\*)/i },
  { kind: 'отключена проверка TLS-сертификата', onRemoval: false, re: /(rejectUnauthorized\s*:\s*false|verify\s*=\s*False|ssl_verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|CURLOPT_SSL_VERIFYPEER\s*,\s*(0|false))/i },
  { kind: 'внесён eval/динамическое исполнение', onRemoval: false, re: /(\beval\(|new Function\(|child_process[\s\S]{0,20}exec\(|os\.system\(|subprocess\.\w+\([^)]*shell\s*=\s*True|\bexec\s*\()/i },
  { kind: 'внесён небезопасный HTML (XSS-поверхность)', onRemoval: false, re: /(dangerouslySetInnerHTML|\.innerHTML\s*=|v-html|\|\s*safe\b|mark_safe\(|\{\{\{)/i },
  { kind: 'отключена/ослаблена CSRF-защита', onRemoval: false, re: /(csrf\s*:\s*false|csrf_exempt|@csrf_exempt|WTF_CSRF_ENABLED\s*=\s*False|disable\w*[_-]?csrf)/i },
  { kind: 'подавлен анализатор безопасности', onRemoval: false, re: /(#\s*nosec|eslint-disable[\w-]*security|\/\/\s*nosemgrep|#\s*noqa:\s*S\d|@SuppressWarnings\([^)]*security)/i },
]

/** Строки диффа: '+' добавленные (кроме '+++'), '-' удалённые (кроме '---'). */
function splitDiff(diff: string): { added: string[]; removed: string[] } {
  const added: string[] = []
  const removed: string[] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1))
    else if (line.startsWith('-') && !line.startsWith('---')) removed.push(line.slice(1))
  }
  return { added, removed }
}

/**
 * Находки ослабления защиты в диффе. Для «снятой защиты» требуем, чтобы паттерн
 * был в УДАЛЁННЫХ и НЕ вернулся в добавленных (иначе это перемещение/рефактор, не
 * снятие) — режет главный класс ложных срабатываний.
 */
export function detectSecurityRegressions(diff: string): SecurityFinding[] {
  const { added, removed } = splitDiff(diff)
  if (added.length === 0 && removed.length === 0) return []
  const addedText = added.join('\n')
  const removedText = removed.join('\n')
  const out: SecurityFinding[] = []
  const seen = new Set<string>()

  const push = (kind: string, sample: string): void => {
    if (seen.has(kind)) return
    seen.add(kind)
    out.push({ kind, detail: sample.trim().slice(0, 80) })
  }

  for (const rule of REMOVAL_RULES) {
    const m = removedText.match(rule.re)
    if (m && !rule.re.test(addedText)) push(rule.kind, m[0]) // снято и не возвращено
  }
  for (const rule of ADDITION_RULES) {
    const m = addedText.match(rule.re)
    if (m) push(rule.kind, m[0])
  }
  return out
}
