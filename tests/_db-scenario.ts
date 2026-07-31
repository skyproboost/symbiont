/**
 * Сценарий-эталон для слоя хранилища: ОДИН код, который прогоняется обоими
 * драйверами (bun:sqlite в процессе теста, node:sqlite — реальным процессом
 * node). Сравниваются не ожидания, написанные руками дважды, а два ответа на
 * один и тот же вопрос: разошлись — значит слой совместимости дырявый.
 *
 * Здесь намеренно собраны те места, где драйверы РАЗНЫЕ по природе: промах
 * .get(), связывание boolean/undefined, форма результата записи, миграционный
 * PRAGMA table_info и ожидание блокировки.
 */
import { openDb, driverKind } from '../src/core/db'

export function dbScenario(dbPath: string): Record<string, unknown> {
  const db = openDb(dbPath)
  const out: Record<string, unknown> = { driver: driverKind() }

  db.run('CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, flag INTEGER, note TEXT)')
  const ins = db.query('INSERT INTO t(name, flag, note) VALUES(?,?,?)')

  // boolean и undefined: bun их принимает, node — нет; слой обязан выровнять
  out.insertTrue = ins.run('первый', true, undefined)
  out.insertFalse = ins.run('второй', false, 'есть')

  out.rows = db.query('SELECT id, name, flag, note FROM t ORDER BY id').all()
  // промах: у bun null, у node undefined — наружу всегда null
  out.miss = db.query('SELECT * FROM t WHERE id = ?').get(999)
  out.hit = db.query('SELECT name FROM t WHERE id = ?').get(1)
  // строка результата должна вести себя как обычный объект (у node прототип null)
  out.spread = { ...(out.hit as Record<string, unknown>) }
  out.json = JSON.stringify(out.hit)

  // на этом держатся все миграции схемы
  out.columns = (db.query('PRAGMA table_info(t)').all() as Array<{ name: string }>).map((c) => c.name)

  // ожидание блокировки: молчаливая потеря подачи начиналась здесь
  out.busyTimeout = db.query('PRAGMA busy_timeout').get()

  out.update = db.run('UPDATE t SET note = ? WHERE name = ?', null, 'первый')
  out.deleted = db.run('DELETE FROM t WHERE flag = ?', false)
  out.left = db.query('SELECT COUNT(*) AS n FROM t').get()

  db.close()
  return out
}
