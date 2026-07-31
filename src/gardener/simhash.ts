/**
 * SimHash 64 бита для почти-дубликатов фактов (Google-паттерн, наш масштаб —
 * линейное попарное сравнение, никаких LSH-таблиц).
 */
import { createHash } from 'node:crypto'

const MASK64 = (1n << 64n) - 1n

function tokens(text: string, maxTokens: number): string[] {
  // Грубый стемминг (первые 5 символов) гасит русскую морфологию
  // («единые источники» ≈ «единый источник»); только униграммы —
  // биграммы на коротких перефразировках раздувают дистанцию.
  const all = text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 5))
  return all.length > maxTokens ? all.slice(0, maxTokens) : all
}

/**
 * maxTokens ограничивает разбор длинного входа. Фактам он не нужен (утверждение
 * — одна фраза), а блокам кода нужен: один сгенерированный файл в тысячи токенов
 * стоил бы больше, чем весь остальной проход (замерено: 72с против 1.5с).
 * Похожесть решается началом текста — хвост её почти не двигает.
 */
export function simhash(text: string, maxTokens = Number.MAX_SAFE_INTEGER): bigint {
  const v = new Array<number>(64).fill(0)
  for (const t of tokens(text, maxTokens)) {
    const h = BigInt('0x' + createHash('sha1').update(t).digest('hex').slice(0, 16))
    for (let bit = 0; bit < 64; bit++) {
      v[bit] += (h >> BigInt(bit)) & 1n ? 1 : -1
    }
  }
  let out = 0n
  for (let bit = 0; bit < 64; bit++) if (v[bit] > 0) out |= 1n << BigInt(bit)
  return out & MASK64
}

export function hamming(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK64
  let n = 0
  while (x) {
    x &= x - 1n
    n++
  }
  return n
}
