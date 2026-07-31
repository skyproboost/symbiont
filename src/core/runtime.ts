/**
 * Предпосылки к окружению: что плагину нужно от машины владельца и что делать,
 * когда этого нет.
 *
 * История вопроса. Symbiont начинался как плагин, требующий bun: манифесты звали
 * `bun run`, хранилище держалось на `bun:sqlite`. На машине без bun не стартовал
 * ни один канал, причём МОЛЧА — владелец видел не ошибку, а отсутствие плагина.
 * Аксиома живучести (CONCEPT §7) требует минимума обязательных предпосылок, и
 * этот минимум теперь такой: рантайм со встроенным SQLite. Их два — bun любой
 * версии и Node 22.13+ (`node:sqlite` без флага). Работу с обоими ведёт
 * core/db.ts, драйвер грузится отсюда — единственного места, которое вправе
 * спрашивать у машины, что на ней есть.
 *
 * Обязанность модуля не изменилась: сделать нехватку предпосылок ВИДИМОЙ и
 * объяснимой. Проверка — попыткой загрузки, а не сравнением версий: версия
 * говорит, чего ожидать, а загрузка — что есть на самом деле.
 *
 * Отдельно про окна на Windows: плагин не вправе показывать консоль. Любой
 * порождаемый процесс запускается скрыто, а для открытия файлов используется
 * GUI-программа системы, а не консольная команда.
 */
import { createRequire } from 'node:module'

export interface RuntimeReport {
  /** на чём мы сейчас исполняемся */
  runtime: 'bun' | 'node' | 'неизвестно'
  version: string
  /** есть ли встроенное хранилище — без него паспорт хранить негде */
  hasStorage: boolean
  /** что мешает работать; пусто — всё в порядке */
  problems: string[]
}

/** Версия Node, начиная с которой node:sqlite доступен без флага запуска. */
const NODE_SQLITE_MIN = '22.13'

const requireDriver = createRequire(import.meta.url)

/**
 * Загрузка драйвера хранилища. Имя собирается из кусков намеренно: литеральный
 * require сборщик пытается разрешить на месте, а разрешить чужой рантайм он не
 * может — вычисленное имя оставляет загрузку рантайму. Отсутствие драйвера —
 * не исключение, а null: это штатный ответ на вопрос «а есть ли он тут».
 */
export function loadSqliteDriver(runtime: 'bun' | 'node'): unknown | null {
  try {
    return requireDriver(`${runtime}:sqlite`)
  } catch {
    return null // рантайм без встроенного хранилища — про это и спрашивали
  }
}

export function inspectRuntime(
  env: { bun?: string; node?: string } = {
    bun: (globalThis as { Bun?: { version: string } }).Bun?.version,
    node: typeof process !== 'undefined' ? process.versions?.node : undefined,
  },
  hasDriver: (runtime: 'bun' | 'node') => boolean = (runtime) => loadSqliteDriver(runtime) !== null,
): RuntimeReport {
  const problems: string[] = []

  if (env.bun) {
    return { runtime: 'bun', version: env.bun, hasStorage: true, problems }
  }

  if (env.node) {
    const hasStorage = hasDriver('node')
    if (!hasStorage) {
      problems.push(
        `Node ${env.node}: встроенного хранилища нет (нужен Node ${NODE_SQLITE_MIN}+ или bun) — паспорт сохранять негде`,
      )
    }
    return { runtime: 'node', version: env.node, hasStorage, problems }
  }

  problems.push('рантайм не опознан: ни bun, ни node не обнаружены')
  return { runtime: 'неизвестно', version: '', hasStorage: false, problems }
}

/**
 * Сообщение владельцу. Появляется только при реальной проблеме: рабочая машина
 * не должна получать ни строки — молчание здесь и есть признак здоровья.
 */
export function renderRuntimeWarning(r: RuntimeReport): string {
  if (r.problems.length === 0) return ''
  return [
    '- ⚠ Symbiont не может работать в этом окружении:',
    ...r.problems.map((p) => `  ${p}`),
    '  Плагин ничего не сломает, но паспорт проекта собран не будет.',
  ].join('\n')
}

/**
 * Опции запуска дочернего процесса, при которых на Windows не появляется окно
 * консоли. Вынесено в одно место намеренно: правило «плагин не показывает окон»
 * должно соблюдаться везде, а не там, где о нём вспомнили.
 */
export function silentSpawnOptions(detached = true): {
  detached: boolean
  stdio: 'ignore'
  windowsHide: boolean
} {
  return { detached, stdio: 'ignore', windowsHide: true }
}

/**
 * Чем открыть файл в графической оболочке системы. На Windows это explorer, а
 * НЕ `cmd /c start`: cmd — консольная программа, её запуск мелькает чёрным
 * окном. Плата за explorer — ненулевой код возврата всегда, поэтому по нему
 * судить об успехе нельзя.
 */
export function fileOpener(platform: string = process.platform): { cmd: string; usesShell: boolean } {
  if (platform === 'win32') return { cmd: 'explorer.exe', usesShell: false }
  if (platform === 'darwin') return { cmd: 'open', usesShell: false }
  return { cmd: 'xdg-open', usesShell: false }
}
