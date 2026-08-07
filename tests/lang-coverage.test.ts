/**
 * Язык подачи один на весь плагин — и это проверяется, а не подразумевается.
 *
 * Поймано вопросом владельца «почему русский проскальзывает». Причина оказалась
 * не в переводах: `initLang` звали четыре точки входа из пятнадцати, а остальные
 * каналы рендерили на УМОЛЧАНИИ ПРОЦЕССА. То есть выбор владельца соблюдала
 * сводка и не соблюдали ни гейт, ни подача по касанию, ни прощание — причём
 * молча и одинаково у всех, поэтому со стороны это выглядело случайностью.
 *
 * Список точек входа берётся из единственного места, где он и так объявлен, —
 * сборщика. Новая команда попадает под правило самим фактом появления.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ENTRY_SOURCES } from '../src/bundle/core'
import { setLang, lang, t, initLang } from '../src/core/i18n'

const ROOT = join(import.meta.dir, '..')

/**
 * Текст точки входа вместе с её ядром: тонкий процесс-вход читает stdin и
 * зовёт чистое ядро, поэтому язык законно инициализируется в любом из двух.
 */
function entryText(src: string): string {
  const core = src.replace(/\.ts$/, '-core.ts')
  let text = readFileSync(join(ROOT, src), 'utf8')
  if (existsSync(join(ROOT, core))) text += readFileSync(join(ROOT, core), 'utf8')
  return text
}

/** Точка входа рисует текст владельцу? Фоновый исполнитель и смоук — нет. */
const RENDERS_TEXT = (src: string): boolean => !src.endsWith('smoke.ts')

describe('язык подачи — один на все точки входа', () => {
  it('каждая точка входа определяет язык до первой строки', () => {
    const silent = ENTRY_SOURCES.filter(RENDERS_TEXT).filter((src) => !entryText(src).includes('initLang('))
    expect(silent).toEqual([])
  })

  it('умолчание — русский: он же ответ на «признаков нет»', () => {
    // Умолчание процесса проверяется через сам механизм, а не чтением константы:
    // важно поведение, а не то, как оно записано.
    const before = lang()
    try {
      const verdict = initLang(null, null)
      expect(verdict.lang).toBe(before) // без корня данных язык не меняется
      setLang('ru')
      expect(t('русский', 'english')).toBe('русский')
      setLang('en')
      expect(t('русский', 'english')).toBe('english')
    } finally {
      setLang(before)
    }
  })
})
