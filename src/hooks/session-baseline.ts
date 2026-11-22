/**
 * Точка отсчёта сессии: что уже было удалено из дерева к её старту.
 *
 * Страж тестов сравнивает дерево с коммитом, на котором сессия началась. Для
 * правок это верно, для удалений — нет: удаление, оставшееся незакоммиченным,
 * от этого коммита видно КАЖДОЙ следующей сессии, и стоило ей выполнить любую
 * удаляющую команду с тем же именем каталога, как давняя чужая работа
 * приписывалась ей (vidrixhq: одни и те же 12 тестов в трёх сессиях подряд).
 * Коммит отвечает на вопрос «что было закоммичено», а нужен ответ на вопрос
 * «что было на диске» — его даёт только снимок в момент старта.
 *
 * Снимок пишется один раз на сессию: повторный SessionStart той же сессии
 * (сжатие контекста, продолжение) его не трогает — иначе удалённое самой
 * сессией до сжатия стало бы «бывшим до старта» и ушло бы из-под стража.
 * Хранятся только тестовые пути: больше никто снимок не читает, а в проекте с
 * сотнями незакоммиченных удалений полный список был бы мёртвым грузом.
 *
 * Таблица эфемерная (чистится pruneEphemeral вместе с прочими посессионными).
 */
import { spawnSync } from 'node:child_process'
import type { Database } from '../core/db'
import { isTestPath } from '../passport/signals'

/** Строка-метка «снимок снят»: пустой снимок обязан отличаться от отсутствующего. */
const MARK = ''
const MAX_FILES = 5000

/**
 * Отслеживаемые файлы, которых в дереве нет (удаление не закоммичено); null —
 * git не ответил. Тот же запрос и тот же вид имён (`-z`, без кавычек и
 * экранирования), что у стража на Stop: снимок и находка обязаны сравниваться
 * строка в строку, а путь с пробелом обычный вывод берёт в кавычки.
 */
export function deletedTracked(cwd: string): string[] | null {
  try {
    const r = spawnSync('git', ['diff', 'HEAD', '--name-only', '--diff-filter=D', '-z'], { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    return r.status === 0 && typeof r.stdout === 'string' ? r.stdout.split('\0').filter(Boolean) : null
  } catch {
    return null // git недоступен — снимка не будет, страж судит по прежнему правилу
  }
}

/**
 * Записать снимок. Зовётся только при ОТКРЫТИИ сессии (новая строка в журнале
 * сессий), а не при всяком SessionStart: у сессии, начатой до обновления
 * плагина, снимка нет, и её первое сжатие записало бы удалённое ею самой как
 * «бывшее до старта». Метка пишется последней: прерванная запись оставляет
 * снимок без метки, то есть отсутствующим, а не частичным.
 */
export function recordGoneAtStart(db: Database, sid: string, deleted: string[] | null): void {
  if (deleted === null) return
  try {
    db.run('CREATE TABLE IF NOT EXISTS session_gone(session_id TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY(session_id, file))')
    const add = db.query('INSERT OR IGNORE INTO session_gone(session_id, file) VALUES(?,?)')
    for (const file of deleted.filter(isTestPath).slice(0, MAX_FILES)) add.run(sid, file)
    add.run(sid, MARK)
  } catch {
    // Снимок — уточнение: без него страж работает по прежнему правилу
  }
}

/** Тесты, удалённые до старта сессии; null — снимка нет (сессия началась до обновления плагина). */
export function goneAtStart(db: Database, sid: string): Set<string> | null {
  try {
    const rows = db.query('SELECT file FROM session_gone WHERE session_id=?').all(sid) as Array<{ file: string }>
    if (!rows.some((r) => r.file === MARK)) return null
    return new Set(rows.map((r) => r.file).filter((f) => f !== MARK))
  } catch {
    return null // таблицы нет — снимков ещё не снимали
  }
}
