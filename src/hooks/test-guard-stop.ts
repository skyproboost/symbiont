/**
 * Страж тестов на Stop: сбор сырья — какие тесты судить и против чего сравнивать.
 *
 * Сам суд чистый и живёт в `verifiers/test-guard.ts`; здесь только то, что
 * требует git и диска. Отдельным модулем, а не блоком в `stop-core.ts`: тот и
 * так самый большой файл проекта, и собственный бюджет качества назвал его рост,
 * когда страж был вписан туда целиком.
 *
 * Подсудны подтверждённо свои тесты (журнал авторства и правки из эпизодов
 * транскрипта) плюс, пока сессия в репозитории одна, всё грязное дерево — та же
 * граница, что у гейта формы. Удаление идёт мимо инструментов правки, поэтому
 * его авторство подтверждает только удаляющая команда в транскрипте.
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { RunHistory } from '../gates/evidence'
import { commandDeletes } from './deleted-by'
import { guardTests, type TestFinding } from '../verifiers/test-guard'
import { isTestPath } from '../passport/signals'
import { isSecretCarrier } from '../env/config-graph'
import { inDerivedZone } from '../miner/walk'

/** Строка `git status --porcelain`: две буквы статуса и путь (у переименования — новый). */
export interface DirtyEntry {
  /** `??` — неотслеживаемый, `D` в любой позиции — удалён */
  status: string
  file: string
}

/** Столько тест-файлов судит страж за ход: каждый стоит одного запуска git. */
const MAX_TEST_FILES = 12
/** Тест крупнее этого стражем не читается — как и гейт, он не жуёт гигантов. */
const MAX_TEST_BYTES = 1_000_000

/**
 * Коммит, на котором сессия началась, — последний до её старта.
 *
 * Страж сравнивает с ним, а не с HEAD: модель нередко коммитит внутри того же
 * хода, и к моменту Stop дерево уже чистое — дифф против HEAD пуст, а ослабленный
 * тест лежит в истории. Отвергнуто хранить SHA в журнале сессий: это новая
 * колонка и миграция ради значения, которое git отдаёт одним вызовом.
 */
function sessionBase(cwd: string, sinceIso: string): string | null {
  try {
    // Строго РАНЬШЕ старта. У git секундная точность и сравнение «не позже»:
    // коммит, сделанный в ту же секунду, что и старт сессии, сам стал бы базой,
    // и дифф против него был бы пуст. Секунда назад превращает «не позже» в
    // «раньше»; коммит владельца за секунду до запуска сессии невозможен — она
    // стартует дольше.
    const started = Date.parse(sinceIso)
    const before = Number.isNaN(started) ? sinceIso : new Date(started - 1000).toISOString()
    const r = spawnSync('git', ['rev-list', '-1', `--before=${before}`, 'HEAD'], { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true })
    const sha = r.status === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : ''
    return sha || null
  } catch {
    return null // git недоступен — страж сравнит с HEAD
  }
}

/** Дифф рабочего дерева против базы; null — git не ответил, судить не по чему. */
function diffAgainst(cwd: string, base: string, args: string[]): string | null {
  try {
    const r = spawnSync('git', ['diff', base, ...args], { cwd, encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : null
  } catch {
    return null // транзиент git — страж молчит, а не обвиняет по пустому диффу
  }
}

export interface TestGuardWorld {
  cwd: string
  /** грязное дерево — уже снято Stop-хуком, второй `git status` не нужен */
  dirty: DirtyEntry[]
  /** подтверждённо свои правки (журнал авторства PostToolUse) */
  own: Set<string>
  /** сколько чужих сессий живо в репозитории: при соседях грязное дерево не наше */
  parallel: number
  history: RunHistory
  sessionStartMs: number
  sinceIso: string
  /** тесты, удалённые из дерева ещё до старта сессии; null — снимка нет */
  goneBefore?: Set<string> | null
}

/**
 * Находки стража за этот ход. Ни одного запуска git, пока нет ни тестов-кандидатов,
 * ни удаляющих команд, — обычный ход без тестов стоит только чтения транскрипта.
 */
export function testGuardFindings(w: TestGuardWorld): TestFinding[] {
  const judged = (f: string): boolean => isTestPath(f) && !inDerivedZone(f) && !isSecretCarrier(f)
  const freshOnDisk = (f: string): boolean => {
    try {
      return statSync(join(w.cwd, f)).mtimeMs >= w.sessionStartMs
    } catch {
      return false // файла нет — удаление разбирается отдельно
    }
  }
  const dirtyTests = w.parallel > 0 ? [] : w.dirty.filter((e) => !e.status.includes('D') && judged(e.file) && freshOnDisk(e.file)).map((e) => e.file)
  const candidates = [...new Set([...[...w.own].filter(judged), ...w.history.episodes.flatMap((ep) => ep.edited).filter(judged), ...dirtyTests])].slice(0, MAX_TEST_FILES)
  if (candidates.length === 0 && w.history.deletions.length === 0) return []

  const base = sessionBase(w.cwd, w.sinceIso) ?? 'HEAD'
  const untracked = w.dirty.filter((e) => e.status === '??').map((e) => e.file)
  const existing = new Map<string, string>()
  const fresh = new Map<string, string>()
  for (const rel of candidates) {
    const diff = diffAgainst(w.cwd, base, ['--', rel])
    if (diff === null) continue
    if (/^new file mode/m.test(diff)) fresh.set(rel, diff)
    else if (diff.trim() && !/^deleted file mode/m.test(diff)) existing.set(rel, diff)
    // Пустой дифф у существующего файла: git не показывает неотслеживаемое.
    // Каталог целиком новым porcelain сворачивает в одну строку `dir/`.
    else if (!diff.trim() && (w.history.created.has(rel) || untracked.some((u) => u === rel || (u.endsWith('/') && rel.startsWith(u))))) {
      try {
        const abs = join(w.cwd, rel)
        if (statSync(abs).size <= MAX_TEST_BYTES) fresh.set(rel, readFileSync(abs, 'utf8').split('\n').map((l) => '+' + l).join('\n'))
      } catch {
        /* файл исчез между status и чтением — учитывать нечего */
      }
    }
  }

  let deleted: string[] = []
  if (w.history.deletions.length > 0) {
    // Удалённое до старта сессии — не её работа, какой бы командой она потом ни
    // удаляла рядом (session-baseline.ts). Снимка нет — судим по прежнему правилу.
    const before = w.goneBefore ?? null
    // `-z`: имена как есть, через нулевой байт. Обычный вывод берёт путь с
    // пробелом или кириллицей в кавычки и экранирует — такой путь не совпал бы
    // ни со снимком, ни с командой
    // Удалён — значит, файла нет на диске. Для git «удалён» и файл, снятый с
    // индекса (`git rm --cached`): он лежит на месте, и называть его удалённым тестом нельзя
    const onDisk = (f: string): boolean => {
      try {
        return statSync(join(w.cwd, f)).isFile()
      } catch {
        return false
      }
    }
    const gone = (diffAgainst(w.cwd, base, ['--name-only', '--diff-filter=D', '-z']) ?? '')
      .split('\0')
      .filter((f) => f && judged(f) && !before?.has(f) && !onDisk(f))
    // Удаляла ли файл хоть одна из команд сессии — решает разбор операндов (deleted-by.ts)
    deleted = gone.filter((f) => w.history.deletions.some((command) => commandDeletes(command, w.cwd, f))).slice(0, MAX_TEST_FILES)
  }
  return guardTests({ existing, fresh, deleted, history: w.history })
}
