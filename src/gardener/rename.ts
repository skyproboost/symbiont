/**
 * Миграция знания при переименовании файла (git-стиль rename detection).
 *
 * Боль: знание узла привязано к пути. Переименовали файл — оплаченная LLM-роль
 * (node_summary), тепло (node_heat) и очередь визитов (node_visits) сиротеют,
 * а новый путь начинает с нуля и снова жжёт вызов за ту же роль.
 *
 * Матч — ТОЧНЫЙ по хэшу содержимого (git до порога похожести не понижаемся
 * сознательно): старый путь исчез с диска, его content_hash появился ровно под
 * ОДНИМ новым путём, и у того нет собственного знания → это переименование.
 * Rename+edit не мигрируется: хэша старого содержимого после правки больше ни
 * у кого нет, а ложная миграция хуже сироты — узел получил бы РОЛЬ ЧУЖОГО
 * файла, и подача врала бы с уверенным лицом. Сирота честнее: роль просто
 * родится заново при следующем визите.
 *
 * Текущий набор файлов приходит от сборки (build.ts), а не из file_cache:
 * кэш не чистит удалённые пути и на Windows держит обратные слэши — истиной
 * о «жив ли файл» он быть не может.
 */
import type { Database } from '../core/db'

export function migrateRenames(db: Database, current: Map<string, string>): number {
  try {
    if (current.size === 0) return 0
    const has =
      (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='node_summary'").get() as { n: number }).n > 0
    if (!has) return 0
    const rows = db.query('SELECT file, content_hash FROM node_summary').all() as Array<{ file: string; content_hash: string }>
    if (rows.length === 0) return 0

    const summarized = new Set(rows.map((r) => r.file))
    const byHash = new Map<string, string[]>()
    for (const [f, h] of current) {
      const list = byHash.get(h) ?? []
      list.push(f)
      byHash.set(h, list)
    }

    let migrated = 0
    for (const r of rows) {
      if (current.has(r.file)) continue // файл жив — не сирота
      const candidates = byHash.get(r.content_hash) ?? []
      if (candidates.length !== 1) continue // содержимое изменилось или скопировано — неоднозначность = нет миграции
      const to = candidates[0]
      if (summarized.has(to)) continue // у нового пути своё знание — не перетираем
      db.query('UPDATE node_summary SET file=? WHERE file=?').run(to, r.file)
      summarized.add(to)
      // Тепло и визиты следуют за файлом; строка нового пути уже есть — старая
      // просто удаляется (двух истин об одном узле не держим, свежая главнее)
      for (const table of ['node_heat', 'node_visits']) {
        try {
          const exists = db.query(`SELECT 1 x FROM ${table} WHERE file=?`).get(to)
          if (exists) db.query(`DELETE FROM ${table} WHERE file=?`).run(r.file)
          else db.query(`UPDATE ${table} SET file=? WHERE file=?`).run(to, r.file)
        } catch {
          /* таблицы ещё нет — мигрировать нечего */
        }
      }
      migrated++
    }
    return migrated
  } catch {
    return 0 // миграция — обогащение: сирота переживёт до следующего визита
  }
}
