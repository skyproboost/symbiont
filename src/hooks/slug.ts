import { basename } from 'node:path'

/**
 * Имя каталога данных проекта по его пути.
 *
 * Отдельным модулем, а не в ядре SessionStart, где жило раньше: им пользуется
 * выход хука (`emit.ts`), который само ядро SessionStart и импортирует, — из
 * одного файла получался цикл импортов.
 */
export function slugOf(path: string): string {
  // Разделители приводятся к одному виду ДО basename: node:path на Linux не
  // считает обратный слэш разделителем, и виндовый путь целиком превращался бы
  // в слаг («d-ospanel-domains-проект» вместо «проект»). Путь может прийти из
  // конфигурации или с другой машины, поэтому судить по системе нельзя.
  const norm = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return basename(norm).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'project'
}
