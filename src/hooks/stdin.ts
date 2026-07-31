/**
 * Чтение JSON-входа хука из stdin: BOM-безопасно, fail-open.
 *
 * Читаем дескриптор 0 средствами node:fs, а не Bun.stdin: хук обязан работать на
 * любом рантайме (см. core/db.ts — та же причина), а синхронное чтение заодно
 * убирает единственный await из точек входа. Отсутствие входа — не ошибка: канал
 * может быть вызван вручную, и пустой объект честнее исключения.
 */
import { readFileSync } from 'node:fs'

export function readStdinJson<T>(): T | Record<string, never> {
  try {
    const raw = readFileSync(0, 'utf8').replace(/^﻿/, '').trim()
    if (!raw) return {}
    return JSON.parse(raw) as T
  } catch {
    return {}
  }
}
