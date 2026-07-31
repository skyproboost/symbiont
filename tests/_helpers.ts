import { rmSync } from 'node:fs'

/**
 * rm -rf с ретраями: Windows/Defender держит только что закрытые файлы sqlite
 * (WAL/shm) дольше, чем кажется — короткий цикл оставлял утечки temp-каталогов,
 * которые за сотни прогонов забивали C:. Растущий бэкофф до ~4с суммарно почти
 * всегда дожидается снятия локов; остаток (редкий) убирает preload-подметание
 * (tests/_setup.ts) на следующем прогоне.
 */
export function rmrf(path: string): void {
  for (let i = 0; i < 8; i++) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch {
      Bun.sleepSync(120)
    }
  }
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    /* редкий остаток уберёт preload-подметание следующего прогона (tests/_setup.ts) */
  }
}
