/**
 * Детач фонового обслуживания из хуков: слой 1 + LLM-петля одним отцепленным
 * процессом (само-гейт и кулдаун — внутри auto-learn). Общий модуль вместо
 * копии блока в SessionStart/PreCompact (клон-детект v0.58 ловит такое у других).
 *
 * Точка входа зависит от формы поставки: бандл кладёт auto-learn.js рядом с
 * текущим файлом (инвариант сборки: все выходы в одном каталоге dist),
 * dev-режим бежит исходник src/cli/auto-learn.ts.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { slugOf } from './session-start-core'
import { silentSpawnOptions } from '../core/runtime'

/** Путь точки входа auto-learn: бандл-сосед → исходник (dev). */
function autoLearnEntry(): string {
  const bundled = join(import.meta.dirname, 'auto-learn.js')
  if (existsSync(bundled)) return bundled
  return join(import.meta.dirname, '..', 'cli', 'auto-learn.ts')
}

/** Запуск обслуживания, если паспорт проекта уже существует; хук не ждёт. */
export function spawnAutoLearnDetached(cwd: string, dataRoot: string): void {
  const dbPath = join(dataRoot, slugOf(cwd), 'passport.db')
  if (!existsSync(dbPath)) return
  // Рантайм наследуется от текущего процесса (process.execPath), а не берётся
  // именем: хук может исполняться и под bun, и под node — жёсткое 'bun' убивало
  // бы фон на машине без него. Аргумент один (путь входа): и bun, и node
  // запускают файл без подкоманды, а `run` понимает только bun.
  // Опции берутся из одного места: правило «плагин не показывает окон» должно
  // соблюдаться везде, а не там, где о нём вспомнили
  spawn(process.execPath, [autoLearnEntry(), cwd, '--data', dataRoot], silentSpawnOptions()).unref()
}
