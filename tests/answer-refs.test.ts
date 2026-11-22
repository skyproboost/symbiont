/**
 * Сверка ссылок в ответе: что считается ссылкой на файл и что — найденным.
 * Случаи взяты из сухого прогона на транскриптах владельца (22.11.2026): каждое
 * ложное срабатывание первого прогона стало строкой здесь.
 */
import { describe, it, expect } from 'bun:test'
import { extractRefs, judgeRefs, normalizePath, occursAsPath, type RefWorld } from '../src/verifiers/answer-refs'

const paths = (text: string, posixRoots = false): string[] => extractRefs(text, { posixRoots }).map((r) => r.raw)

describe('что в ответе — ссылка на файл', () => {
  it('путь с каталогом, файл:строка, диапазон строк, имя с номером строки', () => {
    expect(paths('Правка в `src/hooks/stop-core.ts:438`, тест — tests/a.test.ts.')).toEqual(['src/hooks/stop-core.ts:438', 'tests/a.test.ts'])
    expect(extractRefs('см. src/a.ts:10-20 и stop-core.ts:7')).toEqual([
      { raw: 'src/a.ts:10', path: 'src/a.ts', line: 10 },
      { raw: 'stop-core.ts:7', path: 'stop-core.ts', line: 7 },
    ])
    expect(paths('D:\\OSPanel\\domains\\x\\строка-новая.txt и ~/.ssh/config.bak-20261122')).toEqual(['D:\\OSPanel\\domains\\x\\строка-новая.txt', '~/.ssh/config.bak-20261122'])
  })

  it('имя без каталога и без строки — не ссылка: `index.ts` ничего не называет', () => {
    expect(paths('поправил `index.ts` и package.json')).toEqual([])
  })

  it('адрес сети, два имени через косую, версия, блок кода, ответ-данные — не ссылки', () => {
    expect(paths('документация: https://code.claude.com/docs/en/hooks.md и github.com/owner/repo.git')).toEqual([])
    expect(paths('не инструментальные package.json/tsconfig.json; экспорт через module.exports/exports.x')).toEqual([])
    expect(paths('версия 2.1.322/next.js')).toEqual([])
    expect(paths('пример:\n```ts\nimport x from "./lib/none.ts"\n```\nконец')).toEqual([])
    expect(paths('[{"file": "src/a.ts", "role": "ядро"}]')).toEqual([])
  })

  it('путь от корня на Windows — адрес страницы, на POSIX — файл; диск в записи Git Bash — файл везде', () => {
    expect(paths('варианты берутся из /products/x.js')).toEqual([])
    expect(paths('правило в /etc/nginx/site.conf', true)).toEqual(['/etc/nginx/site.conf'])
    expect(paths('копия: /d/OSPanel/x/a.ts')).toEqual(['/d/OSPanel/x/a.ts'])
  })
})

describe('что считается найденным', () => {
  const world = (files: Record<string, number>, seenText = ''): RefWorld => ({
    resolve: (path) => (normalizePath(path) in files ? normalizePath(path) : null),
    lines: (resolved) => files[resolved] ?? null,
    seen: (path) => occursAsPath(normalizePath(seenText), path),
  })

  it('есть на диске или встречался в сессии — найден; иначе находка', () => {
    const refs = extractRefs('готово: src/a.ts, удалён tmp/old.ts, отчёт в docs/none.md')
    const found = judgeRefs(refs, world({ 'src/a.ts': 10 }, 'rm D:\\proj\\tmp\\old.ts'))
    expect(found.map((f) => `${f.problem} ${f.ref.raw}`)).toEqual(['missing docs/none.md'])
  })

  it('строка за концом файла — находка; в пределах файла и при неизвестной длине — нет', () => {
    const refs = extractRefs('см. src/a.ts:11, src/a.ts:10 и src/b.ts:999')
    const found = judgeRefs(refs, { ...world({ 'src/a.ts': 10, 'src/b.ts': 5 }), lines: (r) => (r === 'src/a.ts' ? 10 : null) })
    expect(found).toEqual([{ ref: { raw: 'src/a.ts:11', path: 'src/a.ts', line: 11 }, problem: 'line', lines: 10 }])
  })

  it('путь внутри другого пути встреченным не считается', () => {
    expect(occursAsPath('ls contests/a.ts', 'tests/a.ts')).toBe(false)
    expect(occursAsPath('cat d:/proj/tests/a.ts:3', 'tests/a.ts')).toBe(true)
    expect(occursAsPath('open my-tests/a.ts', 'tests/a.ts')).toBe(false)
  })
})
