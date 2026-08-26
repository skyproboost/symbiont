/**
 * Ядро SessionStart-хука (чистая функция — тестируется без процесса).
 *
 * Принципы: fail-open (любая ошибка не должна сломать старт сессии владельца),
 * heartbeat (канал оставляет след срабатывания — самодиагностика),
 * бюджет вывода (обрезка до лимита платформы с указателем на полный файл).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { openDb, type Database } from '../core/db'
import { buildPassport } from '../passport/build'
import { SessionLog, snapshotContent } from '../core/sessions'
import { readConstitution, renderConstitution } from '../core/constitution'
import { gitState, renderGitBlock } from './git-state'
import { reconstructEntry } from './entry'
import { beat } from './heartbeat'
import { silentChannels, readBeats, renderDiagnosis } from './diagnose'
import { sha1 } from '../core/salsa'
import { renderBackground, renderGardenerSilence, REPORTED_WORKS } from '../gardener/scheduler'
import { mutedKinds } from '../gardener/utility'
import { inspectRuntime, renderRuntimeWarning } from '../core/runtime'
import { t, statement, initLang } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации

/**
 * Детекция поправок владельца: файлы, которые человек изменил ПОСЛЕ последнего
 * хода модели (между сессиями). Дифф «модель → человек» — главное сырьё петли
 * самообучения. Обработанные состояния потребляются (идемпотентность).
 */
function detectCorrections(db: Database, cwd: string, currentSid: string): number {
  const hasState =
    (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='model_state'").get() as { n: number }).n > 0
  if (!hasState) return 0
  db.run(
    'CREATE TABLE IF NOT EXISTS corrections(id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, before_content TEXT NOT NULL, from_session TEXT NOT NULL, detected_at TEXT NOT NULL, analyzed INTEGER NOT NULL DEFAULT 0)',
  )
  const rows = db
    .query('SELECT session_id, file, hash, content FROM model_state WHERE session_id != ?')
    .all(currentSid) as Array<{ session_id: string; file: string; hash: string; content: string }>
  let found = 0
  const insert = db.query(
    'INSERT INTO corrections(file, before_content, from_session, detected_at) VALUES(?,?,?,?)',
  )
  const consume = db.query('DELETE FROM model_state WHERE session_id=? AND file=?')
  for (const r of rows) {
    try {
      const nowContent = snapshotContent(readFileSync(join(cwd, r.file), 'utf8'))
      if (sha1(nowContent) !== r.hash) {
        insert.run(r.file, r.content, r.session_id, new Date().toISOString())
        found++
      }
    } catch {
      /* файл исчез — не поправка, просто потребляем */
    }
    consume.run(r.session_id, r.file)
  }
  return found
}

const CONTEXT_CHAR_BUDGET = 8000
/** Ниже этого числа строк секция перестаёт быть секцией — резать дальше нечего. */
const MIN_SECTION_ITEMS = 3

/**
 * Уложить сводку в бюджет, тратя его по ВЕСУ секций, а не по их месту в файле.
 *
 * Слайс по 8000-му символу выглядел безобидно, пока паспорт был мал. На зрелом
 * проекте самая толстая секция — выведенные моделью привычки, и стоит она в
 * файле раньше измеренных: разросшись, она выталкивала из подачи и профиль
 * качества, и карту ключевых модулей — то есть ровно то, ради чего сводку и
 * читают. Отрезанное при этом не называлось: срез приходился на середину
 * строки, и понять, что паспорт подан не целиком, было неоткуда.
 *
 * Режем поштучно и всегда у САМОЙ ДЛИННОЙ секции: перекос лечится там, где он
 * возник, и правило не знает ни одного названия секции — иначе оно сломалось бы
 * на другом языке подачи или на новой секции. Каждая урезанная секция говорит,
 * сколько строк осталось за кадром и где лежит полная версия.
 */
export function fitToBudget(summary: string, budget: number, fullPath: string): string {
  if (summary.length <= budget) return summary
  const parts = summary.split(/\n(?=## )/)
  const blocks = parts.map((p) => {
    const lines = p.split('\n')
    const head = lines.findIndex((l) => l.startsWith('- '))
    return head === -1
      ? { lines, items: [] as string[], dropped: 0 }
      : { lines: lines.slice(0, head), items: lines.slice(head).filter((l) => l.startsWith('- ')), dropped: 0 }
  })
  const render = (): string =>
    blocks
      .map((b) => {
        const tail = b.dropped > 0 ? [`- …${t(`ещё ${b.dropped} — passport_conventions`, `${b.dropped} more — passport_conventions`)}`] : []
        return [...b.lines, ...b.items, ...tail].join('\n')
      })
      .join('\n')

  while (render().length > budget) {
    let fat = -1
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].items.length <= MIN_SECTION_ITEMS) continue
      if (fat === -1 || blocks[i].items.length > blocks[fat].items.length) fat = i
    }
    if (fat === -1) break // все секции у пола — дальше только честный обрыв
    blocks[fat].items.pop()
    blocks[fat].dropped++
  }
  const fitted = render()
  return fitted.length <= budget ? fitted : `${fitted.slice(0, budget)}\n…${t('обрезано; полная версия', 'truncated; full version')}: ${fullPath}`
}

export interface SessionStartInput {
  cwd?: string
  source?: string
  session_id?: string
  /** Путь к транскрипту сессии: единственный доступный признак её живости. */
  transcript_path?: string
}

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'SessionStart'
    additionalContext: string
  }
}

export function slugOf(path: string): string {
  // Разделители приводятся к одному виду ДО basename: node:path на Linux не
  // считает обратный слэш разделителем, и виндовый путь целиком превращался бы
  // в слаг («d-ospanel-domains-проект» вместо «проект»). Путь может прийти из
  // конфигурации или с другой машины, поэтому судить по системе нельзя.
  const norm = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return basename(norm).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'project'
}

export function handleSessionStart(input: SessionStartInput, dataRoot: string): HookOutput {
  const cwd = input.cwd ?? process.cwd()
  const dataDir = join(dataRoot, slugOf(cwd))
  mkdirSync(dataDir, { recursive: true })
  // Язык подачи — явно и до первой строки. Косвенно он и раньше приезжал сюда
  // внутри buildPassport, но такая связь держится на порядке вызовов: стоит
  // сборке паспорта уйти, отмениться или переехать ниже — и сводка молча
  // заговорит на умолчании процесса вместо языка владельца.
  initLang(dataDir, cwd)

  // Heartbeat — до любой работы: даже упавший канал оставляет след попытки.
  beat(dataDir, 'SessionStart', { source: input.source ?? null })

  try {
    const r = buildPassport(cwd, dataDir)

    // Сессионный журнал: открыть текущую, реконсилировать грязно умершие (crash-only);
    // заодно поднять HANDOFF-нить прошлой сессии
    let reconciled = 0
    let threadLine = ''
    let threadFiles: string[] = []
    let gateLine = ''
    let diagLine = ''
    let bgLine = ''
    // Предпосылки к окружению: если плагину негде хранить паспорт, владелец
    // узнаёт об этом строкой в сводке, а не по загадочному отсутствию плагина
    const runtimeLine = renderRuntimeWarning(inspectRuntime())
    let utilLine = ''
    let entryBlock = ''
    let survivalLine = ''
    // git-состояние — до журнала: dirty-файлы нужны реконструкции входа
    const g = gitState(cwd)
    try {
      const db = openDb(join(dataDir, 'passport.db'))
      const log = new SessionLog(db)
      const sid = input.session_id ?? `manual-${Date.now()}`
      // самодиагностика — ДО open(): смотрим пульс против ПРОШЛЫХ сессий
      diagLine = renderDiagnosis(silentChannels(readBeats(dataDir), log.recentStarts(sid)))
      log.open(sid, input.source ?? null, new Date().toISOString(), input.transcript_path ?? null)
      reconciled = log.reconcileStale(sid)
      log.pruneEphemeral() // храповик: посессионные логи не растут вечно
      detectCorrections(db, cwd, sid)

      // Что фон сделал, пока владельца не было: садовник заменил собой команды-
      // отчёты, поэтому его результат приходит сам — фактом в сводке, не по запросу.
      try {
        bgLine = renderBackground(db, REPORTED_WORKS, Date.now())
        // Пустая строка фона двусмысленна: «нечего делать» и «фон мёртв»
        // выглядят одинаково. Второе обязано называться вслух.
        if (bgLine === '') bgLine = renderGardenerSilence(db, Date.now())
      } catch {
        /* фон ещё не бегал — молчим */
      }

      // Подача учится на себе и могла что-то заглушить. Решение системы о самой
      // себе не должно быть тайной («никогда молча» — аксиома §3.10).
      try {
        const muted = mutedKinds(db)
        if (muted.length > 0) {
          utilLine = t(
            `- подача адаптирована: ${muted.map((m) => `${m.kind} (${m.used}/${m.surfaced} окупаемость)`).join(', ')} — здесь не окупалось, приглушено; периодически перепроверяется`,
            `- delivery adapted: ${muted.map((m) => `${m.kind} (${m.used}/${m.surfaced} payoff)`).join(', ')} — it did not pay off here and was dimmed; re-checked from time to time`,
          )
        }
      } catch {
        /* статистики нет — молчим */
      }

      // Поимки гейта усиливают подачу: часто нарушаемое правило — выше в сводке
      const hasGateLog =
        (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='gate_log'").get() as { n: number }).n > 0
      if (hasGateLog) {
        const top = db
          .query('SELECT law, COUNT(*) n FROM gate_log GROUP BY law HAVING n >= 3 ORDER BY n DESC LIMIT 1')
          .get() as { law: string; n: number } | null
        if (top) {
          gateLine = t(
            `- гейт чаще всего ловит: «${statement(top.law)}» — ${top.n} поимок (это правило здесь нарушается регулярно)`,
            `- the gate catches this most often: “${statement(top.law)}” — ${top.n} catches (this rule is broken here regularly)`,
          )
        }
      }

      const hasThreads =
        (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='session_threads'").get() as { n: number }).n > 0
      if (hasThreads) {
        const tcols = (db.query('PRAGMA table_info(session_threads)').all() as Array<{ name: string }>).map((c) => c.name)
        const sel = tcols.includes('commits') ? 'files, updated_at, commits' : 'files, updated_at'
        // Имя `th`, а не `t`: короткое `t` затенило бы функцию перевода из i18n,
        // и строки этого блока молча ушли бы наружу по-русски.
        const th = db
          .query(`SELECT ${sel} FROM session_threads WHERE session_id != ? ORDER BY updated_at DESC LIMIT 1`)
          .get(sid) as { files: string; updated_at: string; commits?: string } | null
        if (th) {
          const files = JSON.parse(th.files) as string[]
          const ageH = Math.max(0, Math.round((Date.now() - Date.parse(th.updated_at)) / 3600_000))
          const age =
            ageH < 1
              ? t('меньше часа назад', 'less than an hour ago')
              : ageH < 48
                ? t(`${ageH}ч назад`, `${ageH}h ago`)
                : t(`${Math.round(ageH / 24)}д назад`, `${Math.round(ageH / 24)}d ago`)
          threadLine = `- ${t('нить прошлой сессии', 'thread of the previous session')} (${age}): ${files.slice(0, 5).join(', ')}${files.length > 5 ? `, … (+${files.length - 5})` : ''}`
          threadFiles = files
          // Что СДЕЛАНО (коммиты сессии) — untrusted, подаём как данные (бэктики убраны, лимит)
          const commits = th.commits ? (JSON.parse(th.commits) as string[]) : []
          if (commits.length > 0) {
            const shown = commits.slice(0, 3).map((c) => c.replace(/`/g, "'").slice(0, 90))
            threadLine += `\n- ${t('прошлая сессия сделала', 'the previous session did')}: ${shown.join('; ')}${commits.length > 3 ? `, … (+${commits.length - 3})` : ''}`
          }
        }
      }
      // Записка выжившего после компакции — crash-only: реконструкция на
      // старте, не запись на выходе (PreCompact инжектить и не может).
      // Суммаризатор компакции пересказывает диалог по своему разумению и,
      // по опубликованным исследованиям, роняет ограничения и середину
      // работы; журнал сессии знает ФАКТЫ — что ИМЕННО этой сессией правлено
      // (session_edits, подтверждённое авторство) и что ловил гейт. Факты
      // подаются дословно, сверка намерения с ними — задача модели.
      if (input.source === 'compact') {
        // Сжатие уносит из окна всё, что было подано и не использовано, а дедуп
        // jit_log помнил подачу до конца сессии — файл, открытый после сжатия,
        // приходил без роли и связей. Использованное остаётся отмеченным: модель
        // это уже правила и знает; неиспользованное снова становится подаваемым.
        try {
          db.run('DELETE FROM jit_log WHERE session_id=? AND used=0', sid)
        } catch {
          /* таблицы может ещё не быть — подача сама её создаст */
        }
        try {
          const edits = db
            .query('SELECT file FROM session_edits WHERE session_id=? ORDER BY edited_at')
            .all(sid) as Array<{ file: string }>
          if (edits.length > 0) {
            const files = edits.map((e) => e.file)
            const shown = files.slice(0, 8).join(', ') + (files.length > 8 ? `, … (+${files.length - 8})` : '')
            survivalLine = t(
              `- правлено ЭТОЙ сессией до сжатия (порядок работы, из журнала — не из пересказа): ${shown}`,
              `- edited by THIS session before compaction (work order, from the journal — not from a summary): ${shown}`,
            )
          }
          const caught = db
            .query('SELECT law, COUNT(*) n FROM gate_log WHERE session_id=? GROUP BY law ORDER BY n DESC LIMIT 2')
            .all(sid) as Array<{ law: string; n: number }>
          if (caught.length > 0) {
            const shown = caught.map((c) => `«${statement(c.law)}» ×${c.n}`).join(', ')
            survivalLine += `${survivalLine ? '\n' : ''}${t(
              `- гейт этой сессии ловил: ${shown} — если правилось, не потеряй фикс при продолжении`,
              `- this session's gate caught: ${shown} — if it was being fixed, do not lose the fix when continuing`,
            )}`
          }
        } catch {
          /* журналов сессии нет — записки нет, сводка и так восстановлена */
        }
      }
      // Протокол самостарта: реконструкция состояния работы + её граф-окружение
      entryBlock = reconstructEntry(db, threadFiles, g?.dirtyTop ?? [], Date.now())
      db.close()
    } catch {
      /* журнал недоступен — сводка важнее */
    }

    // Конституция подаётся даже в пустом проекте (назначена — охраняется с первого коммита)
    const constitution = readConstitution(dataDir)
    const constBlock = constitution ? `\n${renderConstitution(constitution)}\n` : ''

    // Сводка живёт журналом, не только статистикой кода: контентный репозиторий
    // без единого кодового файла всё равно несёт профиль качества/LLM-правила
    let summary = ''
    try {
      summary = readFileSync(r.summaryPath, 'utf8')
    } catch {
      /* проекции нет — падать не из-за чего */
    }
    if (!summary.includes('## ')) summary = '' // один заголовок без секций — не сводка
    if (!summary && !constBlock) return {} // нечего сказать — молчим, не занимаем контекст
    summary = fitToBudget(summary, CONTEXT_CHAR_BUDGET, r.summaryPath)

    let stateBlock = g ? `\n${renderGitBlock(g, reconciled)}` : ''
    // Контекст сжат/форкнут — сводка переинжектится (восстановление после потери
    // паспорта при компакции; для сабагентов форка — впервые). Честная пометка.
    const compactNote =
      input.source === 'compact'
        ? t(
            '- контекст был сжат — паспорт восстановлен (то, что компакция могла выронить)',
            '- the context was compacted — the passport has been restored (what compaction could have dropped)',
          )
        : input.source === 'fork'
          ? t(
              '- сессия форкнута — паспорт подан форку (сабагенты не наследуют контекст родителя)',
              '- the session was forked — the passport was delivered to the fork (subagents do not inherit the parent context)',
            )
          : ''
    for (const line of [runtimeLine, compactNote, survivalLine, threadLine, bgLine, utilLine, gateLine, diagLine]) {
      if (line) stateBlock += `${stateBlock ? '\n' : `\n${t('## Состояние', '## State')}\n\n`}${line}`
    }
    if (stateBlock) stateBlock += '\n'

    const entrySection = entryBlock ? `\n${entryBlock}\n` : ''
    // Рамка легитимности (только чувствительный проект): готовый frame.md пишет
    // buildPassport (из доков + сэмпла контента). Несенситивный → файла нет/пуст
    // → ноль токенов. Fail-open.
    let frameSection = ''
    try {
      const frame = readFileSync(join(dataDir, 'frame.md'), 'utf8').trim()
      if (frame) frameSection = `\n${frame}\n`
    } catch {
      /* нет рамки — молчим */
    }
    const freshness = r.factsExecuted ? t('свежий пересчёт', 'freshly recomputed') : t('кэш (код не менялся)', 'cache (the code has not changed)')
    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `${summary}${constBlock}${frameSection}${stateBlock}${entrySection}\n_Symbiont · ${freshness} · ${t('подробнее по требованию', 'more on demand')}: passport_conventions / passport_history_`,
      },
    }
  } catch (e) {
    // fail-open: сессия владельца важнее нашего контекста
    try {
      appendFileSync(
        join(dataDir, 'errors.log'),
        `${new Date().toISOString()} SessionStart: ${String(e)}\n`,
        'utf8',
      )
    } catch {
      /* даже лог не пишется — молчим */
    }
    return {}
  }
}
