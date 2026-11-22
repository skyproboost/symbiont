/**
 * На Windows Codex ждёт потомков команды хука даже после unref(). Хук оставляет
 * пустой каталог-заявку, а уже работающий MCP этого проекта запускает садовника.
 * Ни команды, ни пути из заявки не читаются.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openDb } from './db'
import { agentHost } from './host'
import { isInternalCall } from './internal'
import { silentSpawnOptions } from './runtime'

function applies(): boolean {
  return process.platform === 'win32' && agentHost() === 'codex' && !isInternalCall()
}

function marker(cwd: string, dataDir: string): string {
  // Одноимённые проекты имеют общий slug, но обслуживать чужой cwd нельзя.
  const project = realpathSync.native(cwd).toLowerCase()
  const key = createHash('sha256').update(project).digest('hex')
  return join(dataDir, `codex-maintenance-${key}.pending`)
}

export function handOffMaintenance(cwd: string, dataDir: string): boolean {
  if (!applies()) return false
  const pending = marker(cwd, dataDir)
  try {
    mkdirSync(pending)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  return true
}

/** Только дочерний процесс MCP держит блокировку; ОС отпускает её при обрыве. */
export function claimMaintenance(cwd: string, dataDir: string): (() => void) | null {
  const pending = marker(cwd, dataDir)
  if (!existsSync(pending)) return null
  // Отдельная база: долгая работа не блокирует чтение и запись паспорта хуками.
  const lock = openDb(join(dataDir, 'codex-maintenance.lock.db'))
  try {
    lock.run('PRAGMA busy_timeout = 0')
    lock.run('BEGIN IMMEDIATE')
    rmdirSync(pending)
    return () => lock.close()
  } catch (e) {
    lock.close()
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || /database is (?:busy|locked)/i.test(String(e))) return null
    throw e
  }
}

export function serveMaintenance(cwd: string, dataDir: string): () => void {
  if (!applies()) return () => {}
  const pending = marker(cwd, dataDir)
  const bundle = join(import.meta.dirname, 'auto-learn.js')
  const entry = existsSync(bundle) ? bundle : join(import.meta.dirname, '..', 'cli', 'auto-learn.ts')
  let running = false
  let retryAt = 0
  function check(): void {
    if (running || Date.now() < retryAt || !existsSync(pending)) return
    running = true
    const done = (retry: boolean): void => {
      running = false
      if (retry) retryAt = Date.now() + 30_000
    }
    try {
      const child = spawn(process.execPath, [entry, cwd, '--data', dirname(dataDir), '--claim-maintenance'], silentSpawnOptions())
      child.once('error', () => done(true))
      child.once('exit', code => done(code !== 0))
      child.unref()
    } catch {
      done(true) // Заявка остаётся на диске, пока исполнитель не начал работу.
    }
  }
  // Нужны оба порядка старта (хук/MCP), замена MCP и потерянные события Windows.
  // В простое — один stat раз в две секунды, пока открыт stdio этой сессии.
  const timer = setInterval(check, 2000)
  timer.unref()
  check()
  return () => clearInterval(timer)
}
