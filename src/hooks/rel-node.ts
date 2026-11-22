/**
 * Путь инструмента → путь узла графа (относительный, forward-slash).
 *
 * Отдельным модулем: им пользуются оба канала правки — состоявшейся и
 * отклонённой, — а канал состоявшейся сам передаёт отклонённую соседу. Живи
 * функция в одном из них, второй импортировал бы первый по кругу.
 */
import { relative } from 'node:path'

const SKIP_ZONES = /(^|\/)(node_modules|\.git|\.data|dist|build|\.nuxt|vendor)(\/|$)/

export function toRelNode(cwd: string, filePath: string): string | null {
  // Разделители приводятся к прямым слэшам ДО сравнения путей: node:path на
  // Linux не считает обратный слэш разделителем, и виндовый путь читался бы как
  // одно имя — файл внутри проекта выглядел бы внешним
  const rel = relative(cwd.replaceAll('\\', '/'), filePath.replaceAll('\\', '/')).replaceAll('\\', '/')
  if (!rel || rel.startsWith('..') || rel.includes(':')) return null // вне проекта
  if (SKIP_ZONES.test(rel)) return null
  return rel
}
