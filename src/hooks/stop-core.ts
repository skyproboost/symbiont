/**
 * Stop-хук: dry-run гейт формы.
 *
 * После каждого хода проверяет изменённые в сессии файлы против законов
 * паспорта. Режим dry-run: только сообщает фактом, НЕ блокирует (правило
 * выкатки: наблюдение сразу, принуждение после обкатки).
 *
 * Анти-шум: только грязные по git кодовые файлы, изменённые после старта
 * сессии; дедуп на сессию+файл+закон; молчание по умолчанию.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb, type Database } from '../core/db'
import { SessionLog, snapshotContent } from '../core/sessions'
import { FactStore } from '../core/store'
import { checkAgainstLaws } from '../gates/checks'
import { runContentVerifiers, contentVerifierActive, loadEntityResolver } from '../verifiers/content'
import { detectSecurityRegressions } from '../verifiers/security'
import { detectFocusDrift, renderFocus } from '../gates/focus'
import { measure, measureBefore, compareBudgets, renderBudgets } from '../gates/budget'
import { checkContract } from '../env/contract'
import { readPolicies } from '../env/policies'
import { isConfigFile } from '../env/config-graph'
import { readRules } from '../env/rules'
import { ENTITY_EXT } from '../graph/entities'
import { inDerivedZone } from '../miner/walk'
import { readGateMode } from '../gates/config'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'
import { sha1 } from '../core/salsa'
import { t, statement, initLang } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации

/** Предохранитель ralph-loop: столько блокировок подряд снимают гейт до конца сессии. */
const FUSE_LIMIT = 8

const JS_FAMILY = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx', '.vue'])
// Гейтуемые расширения: код (законы формы) + контент (верификаторы направления).
const GATED_EXT = new Set([...JS_FAMILY, ...ENTITY_EXT])
const MAX_FILES = 20

export interface StopInput {
  cwd?: string
  session_id?: string
}

export interface StopOutput {
  /** Режим блокировки: ход не закрывается, пока нарушение не исправлено. */
  decision?: 'block'
  reason?: string
  hookSpecificOutput?: {
    hookEventName: 'Stop'
    additionalContext: string
  }
}

/**
 * Дифф файла против HEAD для стража защитных слоёв. Пусто (новый/untracked файл)
 * → синтезируем all-added дифф из содержимого: детектор риска (eval/CORS*) всё
 * равно сработает, снятия защиты в новом файле по определению нет.
 */
function fileDiff(cwd: string, rel: string, content: string): string {
  // Ретрай: под параллельной нагрузкой (Windows) git может транзиентно сбоить/
  // таймаутить — синтетический фолбэк тогда СКРЫЛ БЫ снятие защиты (в нём нет
  // удалённых строк). Вторая попытка со свежим спавном обычно проходит.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = spawnSync('git', ['diff', 'HEAD', '--', rel], { cwd, encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
      if (r.status === 0 && typeof r.stdout === 'string') {
        if (r.stdout.trim()) return r.stdout
        return content.split('\n').map((l) => '+' + l).join('\n') // git ОК, но пусто → новый/untracked файл
      }
    } catch {
      /* транзиент — вторая попытка */
    }
  }
  // git недоступен/HEAD нет — синтетический дифф (детект риска работает, снятие — нет)
  return content.split('\n').map((l) => '+' + l).join('\n')
}

/** Коммиты, сделанные с начала сессии (что СДЕЛАНО — детерминированно из git). */
function sessionCommits(cwd: string, sinceIso: string): string[] {
  try {
    const r = spawnSync('git', ['log', `--since=${sinceIso}`, '--format=%s', '-n', '10'], { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true })
    if (r.status !== 0 || typeof r.stdout !== 'string') return []
    return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10)
  } catch {
    return []
  }
}

/**
 * Конфигурационные файлы проекта — по признаку формата, а не по списку имён.
 * Берём из git (быстро и без обхода дерева), фильтруем детектом.
 */
function gitTrackedConfigs(cwd: string): string[] {
  try {
    const r = spawnSync('git', ['ls-files'], { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    if (r.status !== 0 || typeof r.stdout !== 'string') return []
    return r.stdout
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f && isConfigFile(f))
      .slice(0, 60)
  } catch {
    return []
  }
}

function dirtyGatedFiles(cwd: string): string[] {
  // Ретрай: под параллельной нагрузкой (Windows) git status может транзиентно
  // сбоить/таймаутить — тогда мы «не увидели бы» файлов сессии (пропали бы
  // model_state/гейт/страж). Вторая попытка со свежим спавном обычно проходит.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 12000, windowsHide: true })
      if (r.status === 0 && typeof r.stdout === 'string') {
        return r.stdout
          .split('\n')
          .map((l) => l.slice(3).trim())
          .filter((f) => f && GATED_EXT.has(extname(f).toLowerCase()) && !inDerivedZone(f))
          .slice(0, MAX_FILES)
      }
    } catch {
      /* транзиент — вторая попытка */
    }
  }
  return []
}

/** Файлы, изменённые ИМЕННО этой сессией (журнал авторства PostToolUse). */
function ownEditedFiles(db: Database, sid: string): Set<string> {
  try {
    const rows = db.query('SELECT file FROM session_edits WHERE session_id=?').all(sid) as Array<{ file: string }>
    return new Set(rows.map((r) => r.file))
  } catch {
    return new Set() // таблицы ещё нет — канал PostToolUse не отработал ни разу
  }
}

/**
 * Сколько ЧУЖИХ сессий ЖИВО прямо сейчас (crash-only: closed_at IS NULL).
 *
 * Незакрытая ≠ живая: платформа не гарантирует прощание, поэтому сессия, убитая
 * Ctrl-C или закрытием окна, остаётся в журнале открытой. Считать её соседом —
 * значит держать Stop в осторожном режиме на пустом месте: model_state не
 * пишется по файлам вне канала PostToolUse, и петля поправок недополучает сырьё.
 * Признак жизни — молчание транскрипта, правило одно на весь плагин (sessions.ts).
 */
function otherOpenSessions(db: Database, sid: string): number {
  try {
    return new SessionLog(db).openLiveOthers(sid)
  } catch {
    return 0 // журнала сессий нет — считаем, что мы одни
  }
}

export function handleStop(input: StopInput, dataRoot: string): StopOutput {
  try {
    const cwd = input.cwd ?? process.cwd()
    const dataDir = join(dataRoot, slugOf(cwd))
    // Язык подачи — до первой отрисованной строки: без этого канал говорит на
    // умолчании процесса, а не на языке владельца (см. core/i18n.ts).
    initLang(dataDir, cwd)
    beat(dataDir, 'Stop')
    const dbPath = join(dataDir, 'passport.db')
    if (!existsSync(dbPath)) return {}

    const db = openDb(dbPath)
    try {
      // Законы формы (код) + резолвер сущностей (для верификаторов контента).
      // Раньше пустые законы → ранний выход; теперь контент-проект без законов
      // формы всё равно проходит верификаторы направления и реконсиляцию.
      const laws = new FactStore(db).active().filter((f) => f.tier === 'закон')
      const resolve = loadEntityResolver(db)

      const sid = input.session_id ?? 'manual'
      const session = db.query('SELECT started_at FROM sessions WHERE session_id=?').get(sid) as
        | { started_at: string }
        | null
      const sessionStartMs = session ? Date.parse(session.started_at) : Date.now() - 24 * 3600_000

      db.run(
        'CREATE TABLE IF NOT EXISTS gate_log(session_id TEXT NOT NULL, file TEXT NOT NULL, law TEXT NOT NULL, PRIMARY KEY(session_id, file, law))',
      )
      const dedup = db.query('INSERT OR IGNORE INTO gate_log(session_id, file, law) VALUES(?,?,?)')

      // Политики среды читаются ОДИН раз за ход: они лежат в конфигах проекта
      // и от файла к файлу не меняются
      // Конфигурация ОПОЗНАЁТСЯ, а не перечисляется: список имён устарел бы с
      // первым же новым фреймворком, а форматы (json/yaml/ini/conf/env) конечны
      const configPaths = gitTrackedConfigs(cwd)
      const envPolicies = readPolicies(cwd, configPaths)
      const learnedRules = readRules(db)

      // Файлы, менявшиеся в этой сессии (git porcelain отдаёт forward-slash пути).
      //
      // Почему одной эвристики mtime мало. git status показывает ОБЩЕЕ рабочее
      // дерево, а сессий Claude Code в одном репозитории может быть несколько
      // разом (журнал сессий это прямо допускает — см. reconcileStale). Тогда
      // «грязный + свежий mtime» отдаёт чужую работу как свою: гейт судит соседа,
      // страж фокуса видит несуществующий расфокус, а model_state → corrections
      // фабрикует ложные «поправки владельца», из которых выводятся правила в
      // неприкосновенный журнал.
      //
      // Граница проведена по смыслу проверки, а не по одному правилу для всего:
      // гейт формы судит ФОРМУ ДЕРЕВА — она от авторства не зависит, и ослаблять
      // его из-за соседа нельзя (иначе вторая сессия отключала бы блокировку).
      // А model_state и страж фокуса — утверждения «кто что сделал»: без
      // подтверждённого авторства они не просто шумят, а лгут.
      const parallel = otherOpenSessions(db, sid)
      const own = ownEditedFiles(db, sid)
      const sessionFiles: string[] = []
      const contents = new Map<string, string>()
      for (const rel of dirtyGatedFiles(cwd)) {
        const abs = join(cwd, rel)
        try {
          if (statSync(abs).mtimeMs < sessionStartMs) continue // менялся не в этой сессии
          contents.set(rel, readFileSync(abs, 'utf8'))
          sessionFiles.push(rel)
        } catch {
          continue
        }
      }
      // Свои правки. Когда подтверждать нечем И соседей нет — вся грязь наша по
      // умолчанию: правка владельца руками в редакторе PostToolUse не видна,
      // а терять из-за этого детект поправок нельзя. Отвергнут вариант «всегда
      // только PostToolUse»: правки через Bash (sed/heredoc) тоже не проходят
      // через этот канал, и строгое правило молча обнулило бы петлю.
      const attributable = own.size > 0 || parallel > 0
      const ownFiles = attributable ? sessionFiles.filter((f) => own.has(f)) : sessionFiles
      const unattributed = sessionFiles.filter((f) => !ownFiles.includes(f))
      // «Никогда молча»: пропуск файлов — решение системы о самой себе, и оно
      // обязано быть названо, иначе тишина гейта неотличима от его исправности.
      //
      // Но названо ОДИН РАЗ НА ФАЙЛ — как расфокус и бюджеты рядом. Без дедупа
      // здесь была самоподдерживающаяся петля: additionalContext возвращает ход
      // модели, ход заканчивается, Stop срабатывает снова и отдаёт ТОТ ЖЕ текст —
      // и так до вмешательства человека (наблюдалось 2026-07-31: сессия отвечала
      // «жду» и не могла закрыться). Условие вдобавок липкое: сосед считается
      // живым, пока его транскрипт молчит меньше IDLE_DEAD_HOURS (6 ч), так что
      // убитая Ctrl-C сессия держала петлю часами. Дедуп ставится по ФАЙЛУ, а не
      // по факту «соседи есть»: появится новый неразобранный файл — о нём скажут,
      // повторно об уже названном — нет.
      // Отметку в дедупе ставим ТОЛЬКО когда строка действительно прозвучит: без
      // соседей она не печатается, и «погасить» файл молча значило бы потерять его
      // навсегда — при появлении соседа о нём бы уже не сказали.
      const freshUnattributed =
        parallel > 0 ? unattributed.filter((f) => Number(dedup.run(sid, '#параллель', f).changes) > 0) : []
      const parallelLine =
        freshUnattributed.length > 0
          ? `- параллельных сессий: ${parallel} · ${freshUnattributed.length} изменённых файлов не отнесены к этой сессии — авторство не подтверждено (${freshUnattributed.slice(0, 3).join(', ')}${freshUnattributed.length > 3 ? ', …' : ''})`
          : ''

      // Состояние модели: содержимое файлов после последнего хода — базис для
      // детекции поправок владельца на следующем старте («модель написала → человек исправил»)
      if (ownFiles.length > 0) {
        db.run(
          'CREATE TABLE IF NOT EXISTS model_state(session_id TEXT NOT NULL, file TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(session_id, file))',
        )
        const upsertState = db.query(
          'INSERT INTO model_state(session_id,file,hash,content,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(session_id,file) DO UPDATE SET hash=excluded.hash, content=excluded.content, updated_at=excluded.updated_at',
        )
        const now = new Date().toISOString()
        for (const rel of ownFiles) {
          const content = snapshotContent(contents.get(rel) ?? '')
          upsertState.run(sid, rel, sha1(content), content, now)
        }
      }

      // HANDOFF-нить: над чем шла работа (union файлов) + ЧТО СДЕЛАНО (коммиты
      // сессии) — каскадный handoff для протокола самостарта следующей сессии.
      const sinceIso = session?.started_at ?? new Date(sessionStartMs).toISOString()
      const commits = sessionCommits(cwd, sinceIso)
      if (ownFiles.length > 0 || commits.length > 0) {
        db.run(
          'CREATE TABLE IF NOT EXISTS session_threads(session_id TEXT PRIMARY KEY, files TEXT NOT NULL, updated_at TEXT NOT NULL)',
        )
        const tcols = (db.query('PRAGMA table_info(session_threads)').all() as Array<{ name: string }>).map((c) => c.name)
        if (!tcols.includes('commits')) db.run("ALTER TABLE session_threads ADD COLUMN commits TEXT NOT NULL DEFAULT '[]'")
        const prev = db.query('SELECT files FROM session_threads WHERE session_id=?').get(sid) as { files: string } | null
        const union = [...new Set([...(prev ? (JSON.parse(prev.files) as string[]) : []), ...ownFiles])]
        db.query(
          'INSERT INTO session_threads(session_id, files, commits, updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET files=excluded.files, commits=excluded.commits, updated_at=excluded.updated_at',
        ).run(sid, JSON.stringify(union), JSON.stringify(commits), new Date().toISOString())
      }

      // Все текущие нарушения (без дедупа — блокировка обязана видеть повторные):
      // законы формы (код) + верификаторы направления (контент) — единый поток.
      const all: Array<{ file: string; law: string; detail: string }> = []
      for (const rel of sessionFiles) {
        const content = contents.get(rel) ?? ''
        const ext = extname(rel).toLowerCase()
        for (const v of checkAgainstLaws(content, ext, laws)) {
          all.push({ file: rel, law: v.law, detail: v.detail })
        }
        if (contentVerifierActive(ext)) {
          for (const v of runContentVerifiers(rel, content, ext, { resolve })) {
            all.push({ file: rel, law: v.verifier, detail: v.detail })
          }
        }
        // Страж защитных слоёв: ослабление безопасности по диффу (кросс-язык,
        // на любом файле — заголовки/CORS/eval одинаковы вне зависимости от типа)
        for (const s of detectSecurityRegressions(fileDiff(cwd, rel, content))) {
          all.push({ file: rel, law: `защитный слой: ${s.kind}`, detail: s.detail })
        }
        // Контракт среды: код требует от среды то, чего политика проекта не
        // разрешает (CSP, объявленные переменные, поднятые сервисы). Связи между
        // кодом и конфигом нет ни в одном импорте — поэтому её проверяем здесь,
        // до выката, а не ловим отказом в проде.
        for (const c of checkContract(content, envPolicies, learnedRules)) {
          all.push({ file: rel, law: `контракт среды: ${c.kind}`, detail: `${c.requirement} · ${c.policy} · ${c.detail}` })
        }
      }
      // Страж фокуса: расфокус виден из графа и диффов, без единого токена.
      // Отдельно от гейта формы: это не нарушение правила, а наблюдение о ходе
      // работы — сообщается фактом и НИКОГДА не блокирует (намерение решает
      // владелец: он мог расширить задачу осознанно).
      const focusLines: string[] = []
      try {
        const edges = db.query('SELECT from_file, to_file FROM graph_edges').all() as Array<{ from_file: string; to_file: string }>
        const diffs = new Map<string, string>()
        for (const rel of ownFiles) diffs.set(rel, fileDiff(cwd, rel, contents.get(rel) ?? ''))
        const signals = detectFocusDrift({
          sessionFiles: ownFiles,
          edges: edges.map((e) => ({ from: e.from_file, to: e.to_file })),
          diffs,
        })
        // Дедуп по виду сигнала на сессию: расползание сообщается один раз
        const fresh = signals.filter((s) => Number(dedup.run(sid, '#фокус', s.kind).changes) > 0)
        focusLines.push(...renderFocus(fresh))
      } catch {
        /* страж фокуса — наблюдение, его сбой не касается гейта */
      }

      // Бюджеты качества: величины, ухудшение которых не бывает целью работы.
      // Опорная точка — прошлое состояние этих же файлов, а не выдуманное число.
      const budgetLines: string[] = []
      try {
        const withDiffs = sessionFiles.map((rel) => ({
          rel,
          content: contents.get(rel) ?? '',
          diff: fileDiff(cwd, rel, contents.get(rel) ?? ''),
        }))
        if (withDiffs.length > 0) {
          const breaches = compareBudgets(measureBefore(withDiffs), measure(withDiffs))
          for (const line of renderBudgets(breaches)) {
            const metric = line.split('—')[0].replace('- бюджет качества: ', '').trim()
            if (Number(dedup.run(sid, '#бюджет', metric).changes) > 0) budgetLines.push(line)
          }
        }
      } catch {
        /* бюджеты — наблюдение, их сбой не касается гейта формы */
      }

      // Наблюдения о ходе работы — один поток: расфокус, бюджеты качества и
      // отчёт о неразобранном при живых соседних сессиях. Раньше бюджеты
      // считались, но терялись в обеих ветках вывода — печатался только расфокус.
      const observations = [...focusLines, ...budgetLines, parallelLine].filter(Boolean)

      // Статистика поимок — всегда (усиливает подачу правила в сводке)
      // Закон показывается через statement(): в журнале он записан по-русски
      // (по формулировке считается ключ вытеснения), наружу уходит на языке подачи.
      const freshLines = all
        .filter((v) => Number(dedup.run(sid, v.file, v.law).changes) > 0)
        .map((v) => `- ${v.file} · ${t(`«${statement(v.law)}»`, `“${statement(v.law)}”`)} · ${v.detail}`)

      db.run(
        'CREATE TABLE IF NOT EXISTS gate_fuse(session_id TEXT PRIMARY KEY, streak INTEGER NOT NULL DEFAULT 0, released INTEGER NOT NULL DEFAULT 0)',
      )
      const fuse = (db.query('SELECT streak, released FROM gate_fuse WHERE session_id=?').get(sid) as {
        streak: number
        released: number
      } | null) ?? { streak: 0, released: 0 }

      if (all.length === 0) {
        // Чистый ход: серия блокировок обнуляется (предохранитель — про ПОДРЯД)
        if (fuse.streak > 0) db.query('UPDATE gate_fuse SET streak=0 WHERE session_id=?').run(sid)
        // Правила не нарушены, но работа могла разъехаться с задачей — это
        // независимое наблюдение, и молчать о нём только потому, что гейт чист,
        // значило бы потерять единственный сигнал расфокуса.
        if (observations.length > 0) {
          return {
            hookSpecificOutput: {
              hookEventName: 'Stop',
              additionalContext: `Symbiont · ${t('наблюдение о ходе работы (факт, не требование)', 'an observation about how the work is going (a fact, not a demand)')}:\n${observations.join('\n')}`,
            },
          }
        }
        return {}
      }

      const mode = readGateMode(dataDir)
      if (mode === 'block' && fuse.released === 0) {
        const streak = fuse.streak + 1
        db.query(
          'INSERT INTO gate_fuse(session_id, streak, released) VALUES(?,?,0) ON CONFLICT(session_id) DO UPDATE SET streak=excluded.streak',
        ).run(sid, streak)
        if (streak >= FUSE_LIMIT) {
          db.query('UPDATE gate_fuse SET released=1 WHERE session_id=?').run(sid)
          return {
            hookSpecificOutput: {
              hookEventName: 'Stop',
              additionalContext: t(
                `Symbiont · предохранитель гейта: ${FUSE_LIMIT} блокировок подряд — гейт снят до конца сессии (похоже на цикл; ` +
                  `нарушения остаются фактом): ${all.map((v) => `${v.file}: «${statement(v.law)}»`).join('; ')}.`,
                `Symbiont · gate fuse: ${FUSE_LIMIT} blocks in a row — the gate is off until the end of the session (this looks like a loop; ` +
                  `the violations remain a fact): ${all.map((v) => `${v.file}: “${statement(v.law)}”`).join('; ')}.`,
              ),
            },
          }
        }
        return {
          decision: 'block',
          reason: t(
            `Гейт Symbiont (режим блокировки, ${streak}/${FUSE_LIMIT}): изменённые файлы нарушают правила паспорта ` +
              `(законы формы + верификаторы направления) — приведи их к конвенциям проекта и закончи ход:\n` +
              all.map((v) => `- ${v.file} · «${statement(v.law)}» · ${v.detail}`).join('\n') +
              `\nПравила выведены из репозитория (passport_conventions/passport_orphans); если отклонение намеренное — скажи об этом владельцу явно.`,
            `Symbiont gate (blocking mode, ${streak}/${FUSE_LIMIT}): the changed files break the passport's rules ` +
              `(form laws + direction verifiers) — bring them in line with the project's conventions and finish the turn:\n` +
              all.map((v) => `- ${v.file} · “${statement(v.law)}” · ${v.detail}`).join('\n') +
              `\nThe rules are derived from this repository (passport_conventions/passport_orphans); if the deviation is deliberate, say so to the owner explicitly.`,
          ),
        }
      }

      if (freshLines.length === 0 && observations.length === 0) return {}
      const gateBlock =
        freshLines.length > 0
          ? t(
              `Symbiont · dry-run гейта (наблюдение, не блокировка): изменённые файлы нарушают правила паспорта ` +
                `(законы формы + верификаторы направления):\n${freshLines.join('\n')}\n` +
                `Правила выведены из репозитория (passport_conventions/passport_orphans).`,
              `Symbiont · gate dry-run (an observation, not a block): the changed files break the passport's rules ` +
                `(form laws + direction verifiers):\n${freshLines.join('\n')}\n` +
                `The rules are derived from this repository (passport_conventions/passport_orphans).`,
            )
          : ''
      const focusBlock =
        observations.length > 0
          ? `Symbiont · ${t('наблюдение о ходе работы (факт, не требование)', 'an observation about how the work is going (a fact, not a demand)')}:\n${observations.join('\n')}`
          : ''
      return {
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext: [gateBlock, focusBlock].filter(Boolean).join('\n\n'),
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return {} // fail-open
  }
}
