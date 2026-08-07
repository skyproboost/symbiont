/**
 * Утечка языка: канал, который говорит не на том языке, что выбрал владелец.
 *
 * Проверяется не наличие переводов, а СОБЛЮДЕНИЕ ВЫБОРА. Владелец говорит
 * `/symbiont:lang en` один раз — и все каналы обязаны замолчать по-русски, включая
 * те, что рендерят текст мимо сводки: подача до чтения, гейт на правке, блок
 * входа в работу. Раньше выбор соблюдали четыре точки входа из пятнадцати, а
 * остальные рисовали на умолчании процесса — и это выглядело случайностью, а не
 * дефектом, потому что нигде не было сказано вслух.
 *
 * Проба — отсутствие кириллицы: мир теста синтетический, своего русского текста
 * в нём нет, поэтому любая кириллица в выводе пришла из непереведённой строки.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { sha1 } from '../src/core/salsa'
import { FactStore } from '../src/core/store'
import { slugOf } from '../src/hooks/session-start-core'
import { handlePreTool } from '../src/hooks/pre-tool-core'
import { handlePostTool } from '../src/hooks/post-tool-core'
import { reconstructEntry } from '../src/hooks/entry'
import { storeOutline } from '../src/layer1/symbols'
import { setLang } from '../src/core/i18n'
import type { Fact } from '../src/miner/facts'

const CYRILLIC = /[а-яё]/i

/**
 * На время пробы снимаем SYMBIONT_LANG. Preload тестов фиксирует им русский
 * ради воспроизводимости, а переменная сильнее сохранённого выбора (так и
 * задумано: она для разовых прогонов). Здесь проверяется именно путь ВЛАДЕЛЬЦА
 * — выбор, записанный командой, — поэтому переменная не должна его заслонять.
 */
function withoutLangEnv<T>(body: () => T): T {
  const saved = process.env.SYMBIONT_LANG
  delete process.env.SYMBIONT_LANG
  try {
    return body()
  } finally {
    if (saved !== undefined) process.env.SYMBIONT_LANG = saved
  }
}
const BIG = 'export function alpha(): number {\n  return 1\n}\n'.repeat(200)

const LAW: Fact = {
  area: 'стиль',
  statement: 'кавычки — одинарные',
  positive: 50,
  total: 50,
  prevalence: 1,
  tier: 'закон',
}

/** Мир с явным выбором английского: выбор сильнее любого наблюдения. */
function makeEnglishWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-leak-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-leak-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'src', 'core.ts'), BIG)
  writeFileSync(join(proj, 'src', 'api.ts'), "const q = 'x'\n")
  // Сказанное вслух: ровно то, что пишет /symbiont:lang en
  writeFileSync(join(dataDir, 'lang.json'), JSON.stringify({ choice: 'en', lang: 'en', source: 'choice' }), 'utf8')

  const db = openDb(join(dataDir, 'passport.db'))
  new FactStore(db).assertAll([LAW], 'miner:layer0')
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))')
  for (const [f, ind, outd] of [
    ['src/core.ts', 2, 0],
    ['src/api.ts', 0, 1],
  ] as Array<[string, number, number]>) {
    db.query('INSERT INTO graph_nodes(file, rank, in_deg, out_deg) VALUES(?,?,?,?)').run(f, 0.4, ind, outd)
  }
  db.query('INSERT INTO graph_edges(from_file, to_file) VALUES(?,?)').run('src/api.ts', 'src/core.ts')
  storeOutline(db, 'src/core.ts', sha1(BIG), [
    { name: 'alpha', kind: 'function', line: 1, endLine: 3, chars: 40 },
    { name: 'Beta', kind: 'class', line: 5, endLine: 400, chars: 9000 },
  ])
  db.close()
  return { proj, dataRoot, dataDir }
}

describe('выбор английского соблюдают все каналы', () => {
  it('подача до чтения не течёт кириллицей', () => {
    const { proj, dataRoot } = makeEnglishWorld()
    try {
      setLang('ru') // канал обязан переопределить умолчание процесса сам
      const ctx = withoutLangEnv(
        () =>
          handlePreTool(
            { cwd: proj, session_id: 'l1', tool_name: 'Read', tool_input: { file_path: join(proj, 'src/core.ts') } },
            dataRoot,
          ).hookSpecificOutput?.additionalContext ?? '',
      )
      expect(ctx.length).toBeGreaterThan(0)
      expect(ctx.split('\n').filter((l) => CYRILLIC.test(l))).toEqual([])
    } finally {
      setLang('ru')
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('гейт формы на правке не течёт кириллицей', () => {
    const { proj, dataRoot } = makeEnglishWorld()
    try {
      setLang('ru')
      // Пять нарушений: гейт судит по выборке, одиночное совпадение не вердикт
      writeFileSync(join(proj, 'src', 'api.ts'), 'const a = "x"\nconst b = "x"\nconst c = "x"\nconst d = "x"\nconst e = "x"\n')
      const ctx = withoutLangEnv(
        () =>
          handlePostTool(
            { cwd: proj, session_id: 'l2', tool_name: 'Write', tool_input: { file_path: join(proj, 'src/api.ts') } },
            dataRoot,
          ).hookSpecificOutput?.additionalContext ?? '',
      )
      expect(ctx).toContain('law') // гейт действительно сработал, а не промолчал
      expect(ctx.split('\n').filter((l) => CYRILLIC.test(l))).toEqual([])
    } finally {
      setLang('ru')
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('блок входа в работу не течёт кириллицей', () => {
    const { proj, dataRoot, dataDir } = makeEnglishWorld()
    try {
      setLang('en')
      const db = openDb(join(dataDir, 'passport.db'))
      const block = reconstructEntry(db, ['src/core.ts'], [], Date.now())
      db.close()
      expect(block.length).toBeGreaterThan(0)
      expect(block.split('\n').filter((l) => CYRILLIC.test(l))).toEqual([])
    } finally {
      setLang('ru')
      rmrf(proj)
      rmrf(dataRoot)
    }
  })
})
