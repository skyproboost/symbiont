/**
 * Страж тестов: чем проверку сделали зелёной. Источники — транскрипт (порядок
 * «упало → правки → прошло») и дифф тест-файлов против базы сессии.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { setLang, statement } from '../src/core/i18n'
import { runHistory, verdictOf, testsFailed, evidenceFromTranscript, type RunHistory } from '../src/gates/evidence'
import { guardTests, renderTestGuard, TEST_LAWS } from '../src/verifiers/test-guard'
import { isTestPath } from '../src/passport/signals'
import { recordEdit } from '../src/hooks/post-tool-core'
import { handleStop } from '../src/hooks/stop-core'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

let seq = 0
/** Вызов инструмента и его результат — парой строк транскрипта, как пишет Claude Code. */
const use = (name: string, input: Record<string, unknown>, id = `tu-${++seq}`): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const result = (id: string, text: string): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } })
/** Прогон проверки с выводом: строки tool_use + tool_result. */
const run = (output: string, command = 'bun test 2>&1 | tail -5', tool = 'Bash'): string[] => {
  const id = `run-${++seq}`
  return [use(tool, { command }, id), result(id, output)]
}
const RED = ' 12 pass\n 1 fail\nRan 13 tests across 2 files.'
const GREEN = ' 13 pass\n 0 fail\nRan 13 tests across 2 files.'
const toRel = (abs: string): string | null => abs.replace(/^\/proj\//, '')
const noHistory: RunHistory = { episodes: [], created: new Set(), deletions: [], readable: true }

describe('что такое тестовый путь', () => {
  it('каталог, суффикс и имя по классу — тесты; похожие слова — нет', () => {
    for (const f of ['tests/a.test.ts', 'src/a.spec.js', 'pkg/store_test.go', 'spec/models/user_spec.rb', 'app/test_views.py', 'src/UserTest.php', 'Shop/OrderTests.cs', 'src/__tests__/x.tsx']) {
      expect(isTestPath(f)).toBe(true)
    }
    for (const f of ['src/latest.kt', 'src/contest.php', 'src/attestation.ts', 'src/core/store.ts']) expect(isTestPath(f)).toBe(false)
  })
})

describe('вердикт прогона по форме вывода', () => {
  it('красное сильнее зелёного, молчание — неизвестно', () => {
    expect(verdictOf(RED)).toBe('red')
    expect(verdictOf(GREEN)).toBe('green')
    expect(verdictOf('')).toBe('unknown')
    expect(verdictOf('Done in 2.1s')).toBe('unknown')
  })

  it('раннеры разных стеков', () => {
    for (const out of [
      'Tests:       1 failed, 12 passed, 13 total',
      'FAILED tests/test_a.py::test_x - AssertionError\n=== 1 failed, 3 passed in 0.12s ===',
      'FAILURES!\nTests: 5, Assertions: 9, Failures: 1.',
      '--- FAIL: TestStore (0.00s)\nFAIL\tpkg/store\t0.012s',
      'test result: FAILED. 3 passed; 1 failed; 0 ignored',
      '3 examples, 1 failure',
      '  2 passing (12ms)\n  1 failing',
      "src/a.ts(3,1): error TS2322: Type 'string' is not assignable",
      'not ok 2 - rejects bad input',
    ]) {
      expect(verdictOf(out)).toBe('red')
    }
    for (const out of ['Tests:       13 passed, 13 total', '=== 4 passed in 0.10s ===', 'OK (5 tests, 9 assertions)', 'ok  \tpkg/store\t0.011s', 'test result: ok. 4 passed; 0 failed', '3 examples, 0 failures']) {
      expect(verdictOf(out)).toBe('green')
    }
  })

  it('имя прошедшего теста со словом fail — не провал', () => {
    expect(verdictOf('(pass) края > удалённый файл — fail-open молчание [94.00ms]\n 939 pass\n 0 fail')).toBe('green')
    expect(verdictOf('(pass) отбивает 2 errors подряд и 3 failed входа [1.00ms]\n 5 pass\n 0 fail')).toBe('green')
  })

  it('мутационная проба — сломали, упало, вернули, прошло — зелёная: решает последняя сводка', () => {
    expect(verdictOf('=== порча ===\n 10 pass\n 1 fail\n--- возвращено ---\n 1056 pass\n 0 fail\nRan 1056 tests across 102 files.')).toBe('green')
    expect(verdictOf(' Tests  1 failed | 8 skipped (9)\n--- restored ---\n Test Files  24 passed (24)\n      Tests  297 passed (297)')).toBe('green')
    // обратный порядок — прошло, потом упало — красная
    expect(verdictOf(' 13 pass\n 0 fail\n--- вторая часть ---\n 12 pass\n 1 fail')).toBe('red')
  })

  it('у Go сводок нет: упавший пакет выше прошедшего — всё равно красное', () => {
    expect(verdictOf('--- FAIL: TestStore (0.00s)\nFAIL\tpkg/store\t0.012s\nok  \tpkg/api\t0.020s')).toBe('red')
  })

  it('ошибка линтера рядом с зелёными тестами — красное, но тесты не упали', () => {
    const out = ' 13 pass\n 0 fail\nsrc/a.ts\n  3:1  error  x is unused\n✖ 1 problem (1 error, 0 warnings)'
    expect(verdictOf(out)).toBe('red')
    expect(testsFailed(out)).toBe(false)
    expect(testsFailed(' 12 pass\n 1 fail')).toBe(true)
  })
})

describe('история прогонов из транскрипта', () => {
  const write = (lines: string[]): { dir: string; path: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-tg-'))
    const path = join(dir, 't.jsonl')
    writeFileSync(path, lines.join('\n'))
    return { dir, path }
  }

  it('упало → правки → прошло = эпизод; серия красных копит правки в один', () => {
    const { dir, path } = write([
      use('Read', { file_path: '/proj/tests/a.test.ts' }),
      ...run(RED),
      use('Edit', { file_path: '/proj/tests/a.test.ts' }),
      ...run(RED),
      use('Edit', { file_path: '/proj/tests/b.test.ts' }),
      ...run(GREEN),
      use('Edit', { file_path: '/proj/src/later.ts' }),
      ...run(GREEN),
      '{broken',
    ])
    const h = runHistory(path, toRel)
    expect(h.readable).toBe(true)
    expect(h.episodes.map((e) => e.edited)).toEqual([['tests/a.test.ts', 'tests/b.test.ts']])
    rmrf(dir)
  })

  it('эпизод помнит снятые правкой строки; файл, переписанный целиком, — null', () => {
    const { dir, path } = write([
      ...run(RED),
      use('Edit', { file_path: '/proj/tests/a.test.ts', old_string: '  expect(x).toBe(1)\n  const keep = 1', new_string: '  expect(x).toBe(2)\n  const keep = 1' }),
      use('Read', { file_path: '/proj/tests/b.test.ts' }),
      use('Write', { file_path: '/proj/tests/b.test.ts', content: 'x' }),
      ...run(GREEN),
    ])
    const ep = runHistory(path, toRel).episodes[0]
    expect(ep.removed.get('tests/a.test.ts')).toEqual(['expect(x).toBe(1)'])
    expect(ep.removed.get('tests/b.test.ts')).toBeNull()
    rmrf(dir)
  })

  it('эпизод открывают только упавшие тесты: красный линтер и тайпчек — нет', () => {
    for (const lint of ["✖ 1 problem (1 error, 0 warnings)", "tests/a.test.ts(3,1): error TS6133: 'x' is declared but never read."]) {
      const { dir, path } = write([...run(lint, 'npx eslint tests'), use('Edit', { file_path: '/proj/tests/a.test.ts' }), ...run(GREEN)])
      expect(runHistory(path, toRel).episodes).toEqual([])
      rmrf(dir)
    }
  })

  it('сообщение владельца внутри эпизода снимает его: решение прошло через человека', () => {
    const owner = JSON.stringify({ type: 'user', message: { role: 'user', content: 'поменяй ожидание в тесте на 4' } })
    const { dir, path } = write([...run(RED), owner, use('Edit', { file_path: '/proj/tests/a.test.ts' }), ...run(GREEN)])
    expect(runHistory(path, toRel).episodes).toEqual([])
    // служебная строка и isMeta — не владелец, эпизод остаётся
    const meta = JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'контекст хука' } })
    const service = JSON.stringify({ type: 'user', message: { role: 'user', content: '<system-reminder>x</system-reminder>' } })
    writeFileSync(path, [...run(RED), meta, service, use('Edit', { file_path: '/proj/tests/a.test.ts' }), ...run(GREEN)].join('\n'))
    expect(runHistory(path, toRel).episodes.length).toBe(1)
    rmrf(dir)
  })

  it('рождённое сессией — первое касание Write без чтения; прочитанное и перезаписанное — нет', () => {
    const { dir, path } = write([
      use('Write', { file_path: '/proj/tests/new.test.ts' }),
      use('Read', { file_path: '/proj/tests/old.test.ts' }),
      use('Write', { file_path: '/proj/tests/old.test.ts' }),
    ])
    const h = runHistory(path, toRel)
    expect([...h.created]).toEqual(['tests/new.test.ts'])
    rmrf(dir)
  })

  it('оболочка меняла файлы между прогонами — эпизод выбрасывается: «код не трогали» сказать нельзя', () => {
    for (const cmd of ["sed -i 's/1/2/' src/a.ts", 'git checkout -- src/a.ts', 'node gen.js > src/generated.ts', 'Set-Content src/a.ts $x']) {
      const { dir, path } = write([...run(RED), use('Edit', { file_path: '/proj/tests/a.test.ts' }), use('Bash', { command: cmd }), ...run(GREEN)])
      expect(runHistory(path, toRel).episodes).toEqual([])
      rmrf(dir)
    }
    // перенаправление потоков в самой команде проверки правкой не считается
    const { dir, path } = write([...run(RED), use('Edit', { file_path: '/proj/tests/a.test.ts' }), ...run(GREEN, 'bun test 2>&1 | tail -5')])
    expect(runHistory(path, toRel).episodes.length).toBe(1)
    rmrf(dir)
  })

  it('PowerShell — такая же оболочка: проверка из него засчитывается и гейтом доказательств', () => {
    const { dir, path } = write([...run(RED, 'bun test', 'PowerShell'), use('Edit', { file_path: '/proj/tests/a.test.ts' }), ...run(GREEN, 'bun test', 'PowerShell')])
    expect(runHistory(path, toRel).episodes.length).toBe(1)
    writeFileSync(path, [use('Edit', { file_path: '/proj/src/a.ts' }), use('PowerShell', { command: 'bun test' })].join('\n'))
    expect(evidenceFromTranscript(path, new Set(['src/a.ts']), toRel).uncheckedFiles).toEqual([])
    rmrf(dir)
  })

  it('удаляющие команды запоминаются; нет транскрипта — не читается', () => {
    const { dir, path } = write([use('Bash', { command: 'git rm tests/old.test.ts' }), use('PowerShell', { command: 'Remove-Item tests/x.test.ts' }), use('Bash', { command: 'ls tests' })])
    expect(runHistory(path, toRel).deletions.length).toBe(2)
    expect(runHistory(join(dir, 'nope.jsonl'), toRel).readable).toBe(false)
    rmrf(dir)
  })
})

describe('находки по диффу', () => {
  const kinds = (existing: Record<string, string>, fresh: Record<string, string> = {}, history = noHistory, deleted: string[] = []): string[] =>
    guardTests({ existing: new Map(Object.entries(existing)), fresh: new Map(Object.entries(fresh)), deleted, history }).map((f) => `${f.kind}:${f.file}`)

  it('снятое утверждение — убыль; изменённое ожидание — нет', () => {
    expect(kinds({ 'tests/a.test.ts': '@@\n-    expect(total).toBe(3)\n-    expect(ok).toBe(true)\n+    expect(total).toBe(3)\n' })).toEqual(['assertions:tests/a.test.ts'])
    expect(kinds({ 'tests/a.test.ts': '@@\n-    expect(total).toBe(3)\n+    expect(total).toBe(4)\n' })).toEqual([])
  })

  it('закомментированная проверка — снятая проверка', () => {
    expect(kinds({ 'tests/a.test.ts': '@@\n-    expect(total).toBe(3)\n+    // expect(total).toBe(3)\n' })).toEqual(['assertions:tests/a.test.ts'])
    expect(kinds({ 'tests/test_a.py': '@@\n-    assert total == 3\n+    # assert total == 3\n' })).toEqual(['assertions:tests/test_a.py'])
  })

  it('перенос утверждений в другой тест — не убыль; новые проверки в другом файле убыль не гасят', () => {
    const moved = '@@\n-  it("считает", () => {\n-    expect(total).toBe(3)\n-  })\n'
    expect(kinds({ 'tests/a.test.ts': moved }, { 'tests/b.test.ts': '+  it("считает", () => {\n+    expect(total).toBe(3)\n+  })\n' })).toEqual([])
    expect(kinds({ 'tests/a.test.ts': moved }, { 'tests/b.test.ts': '+  it("другое", () => {\n+    expect(other).toBe(1)\n+  })\n' })).toEqual([
      'assertions:tests/a.test.ts',
      'cases:tests/a.test.ts',
    ])
  })

  it('формы других языков', () => {
    expect(kinds({ 'tests/UserTest.php': '@@\n-        $this->assertSame(3, $total);\n' })).toEqual(['assertions:tests/UserTest.php'])
    expect(kinds({ 'app/test_views.py': '@@\n-        self.assertEqual(total, 3)\n-    def test_total(self):\n' })).toEqual(['assertions:app/test_views.py', 'cases:app/test_views.py'])
    expect(kinds({ 'pkg/store_test.go': '@@\n-func TestStore(t *testing.T) {\n-\tt.Fatalf("bad")\n' })).toEqual(['assertions:pkg/store_test.go', 'cases:pkg/store_test.go'])
    expect(kinds({ 'src/lib_test.rs': '@@\n-    assert_eq!(total, 3);\n' })).toEqual(['assertions:src/lib_test.rs'])
  })

  it('форма внутри строкового литерала — не форма: фикстура про `.only` набор не сужает', () => {
    // Поймано догфудингом: тест самого стража держит `it.only(` в строке-фикстуре,
    // и страж назвал это сужением набора в собственном тест-файле
    expect(kinds({}, { 'tests/guard.test.ts': `+    expect(kinds({}, { 'x.test.ts': "+  it.only('один', () => {})" })).toEqual(['narrowed'])\n` })).toEqual([])
    expect(kinds({ 'tests/a.test.ts': '@@\n-  const msg = "expect(total).toBe(3)"\n-  const tpl = `it.skip(${name})`\n' })).toEqual([])
    // а перенос по-прежнему сверяется по тексту как написано: другое ожидание — не тот же перенос
    expect(kinds({ 'tests/a.test.ts': "@@\n-    expect(kind).toBe('a')\n" }, { 'tests/b.test.ts': "+    expect(kind).toBe('b')\n" })).toEqual(['assertions:tests/a.test.ts'])
    // PHP-строка диффа без `<?php` — всё ещё код, а не разметка
    expect(kinds({ 'tests/UserTest.php': "@@\n-        $this->assertSame('x', $name); // имя\n" })).toEqual(['assertions:tests/UserTest.php'])
  })

  it('вызов регэкспа .test( и метод объекта — не тест и не утверждение', () => {
    expect(kinds({ 'tests/a.test.ts': '@@\n-  const ok = /^a$/.test(name)\n-  client.expect(1)\n' })).toEqual([])
  })

  it('пропуск — только в существовавшем тесте; сужение — в любом', () => {
    expect(kinds({ 'tests/a.test.ts': "@@\n-  it('считает', () => {\n+  it.skip('считает', () => {\n" })).toEqual(['skipped:tests/a.test.ts'])
    expect(kinds({ 'tests/test_a.py': '@@\n+@pytest.mark.skip(reason="later")\n' })).toEqual(['skipped:tests/test_a.py'])
    expect(kinds({}, { 'tests/new.test.ts': "+  it.skip('потом', () => {})\n" })).toEqual([])
    expect(kinds({}, { 'tests/new.test.ts': "+  it.only('один', () => {})\n" })).toEqual(['narrowed:tests/new.test.ts'])
    // перенос уже стоявшего пропуска — не новый пропуск
    expect(kinds({ 'tests/a.test.ts': "@@\n-  it.skip('a', () => {})\n+  it.skip('a renamed', () => {})\n" })).toEqual([])
  })

  it('упало → правился только существовавший тест → прошло; свежий тест и правка кода — нет', () => {
    const history = (edited: string[], created: string[] = [], removed: Array<[string, string[] | null]> = []): RunHistory => ({
      episodes: [{ edited, removed: new Map(removed) }],
      created: new Set(created),
      deletions: [],
      readable: true,
    })
    const diff = '@@\n-    expect(total).toBe(3)\n+    expect(total).toBe(4)\n'
    // Свой новый случай в СТАРОМ файле, доведённый до зелёного: снятая правкой
    // строка после базы сессии и родилась — среди исчезнувших её нет
    const ownCase = "@@\n+  it('новое', () => {\n+    expect(fixture(2)).toBe(2)\n+  })\n"
    expect(kinds({ 'tests/a.test.ts': ownCase }, {}, history(['tests/a.test.ts'], [], [['tests/a.test.ts', ['expect(fixture(1)).toBe(2)']]]))).toEqual([])
    // тот же файл, но правка сняла существовавшую строку — это уже правка старого теста
    expect(kinds({ 'tests/a.test.ts': diff + ownCase }, {}, history(['tests/a.test.ts'], [], [['tests/a.test.ts', ['expect(total).toBe(3)']]]))).toEqual(['bent:tests/a.test.ts'])
    const bent = guardTests({ existing: new Map([['tests/a.test.ts', diff]]), fresh: new Map(), deleted: [], history: history(['tests/a.test.ts']) })
    expect(bent.map((f) => f.kind)).toEqual(['bent'])
    expect(bent[0].detail).toContain('строки утверждений изменены')
    expect(kinds({ 'tests/a.test.ts': diff }, {}, history(['tests/a.test.ts', 'src/a.ts']))).toEqual([]) // чинили и код
    expect(kinds({ 'tests/a.test.ts': diff }, {}, history(['tests/a.test.ts'], ['tests/a.test.ts']))).toEqual([]) // тест рождён сессией
    expect(kinds({}, {}, history(['tests/a.test.ts']))).toEqual([]) // правку вернули — диффа нет
  })

  it('удалённый тест — находка; перенос файла под тем же именем — нет', () => {
    expect(kinds({}, {}, noHistory, ['tests/old.test.ts'])).toEqual(['deleted:tests/old.test.ts'])
    expect(kinds({}, { 'tests/unit/old.test.ts': '+x\n' }, noHistory, ['tests/old.test.ts'])).toEqual([])
  })

  it('подача: строка на файл и одна развилка; формулировки переводятся', () => {
    const lines = renderTestGuard(guardTests({ existing: new Map([['tests/a.test.ts', "@@\n-    expect(a).toBe(1)\n-  it('x', () => {\n+  it.skip('x', () => {\n"]]), fresh: new Map(), deleted: [], history: noHistory }))
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain('tests/a.test.ts')
    expect(lines[0]).toContain('утверждений стало меньше на 1')
    expect(lines[0]).toContain('добавлен пропуск')
    expect(lines[1]).toContain('если контракт изменён намеренно')
    expect(renderTestGuard([])).toEqual([])
    setLang('en')
    for (const law of Object.values(TEST_LAWS)) expect(statement(law)).toMatch(/^test guard: /)
    setLang('ru')
  })
})

describe('на Stop', () => {
  /** Проект с закоммиченными кодом и тестом, стартовавшая сессия; возвращает всё нужное для хода. */
  const world = (sid: string): { proj: string; dataRoot: string; transcript: string; g: (...args: string[]) => void; edit: (rel: string, content: string) => void } => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-tg-proj-'))
    const g = (...args: string[]): void => {
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
    }
    g('init', '-b', 'main')
    mkdirSync(join(proj, 'src'))
    mkdirSync(join(proj, 'tests'))
    writeFileSync(join(proj, 'src', 'a.ts'), 'export const total = (): number => 3\n')
    writeFileSync(join(proj, 'tests', 'a.test.ts'), "import { total } from '../src/a'\nit('считает', () => {\n  expect(total()).toBe(3)\n  expect(total()).toBeGreaterThan(0)\n})\n")
    writeFileSync(join(proj, 'tests', 'old.test.ts'), "it('старое', () => {\n  expect(1).toBe(1)\n})\n")
    g('add', '.')
    // Коммит датирован прошлым: база сессии ищется как «последний коммит ДО её старта»
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'база'], {
      cwd: proj,
      encoding: 'utf8',
      env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z' },
    })
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-tg-data-'))
    handleSessionStart({ cwd: proj, source: 'startup', session_id: sid }, dataRoot)
    const edit = (rel: string, content: string): void => {
      writeFileSync(join(proj, rel), content)
      const db = openDb(join(dataRoot, slugOf(proj), 'passport.db'))
      recordEdit(db, sid, rel)
      db.close()
    }
    return { proj, dataRoot, transcript: join(dataRoot, 't.jsonl'), g, edit }
  }
  const bentTest = "import { total } from '../src/a'\nit('считает', () => {\n  expect(total()).toBe(4)\n})\n"

  it('упало → правлен только существовавший тест → прошло: строка один раз, хода не блокирует даже в режиме блокировки', () => {
    const w = world('tg-1')
    w.edit('tests/a.test.ts', bentTest)
    writeFileSync(w.transcript, [use('Read', { file_path: join(w.proj, 'tests', 'a.test.ts') }), ...run(RED), use('Edit', { file_path: join(w.proj, 'tests', 'a.test.ts') }), ...run(GREEN)].join('\n'))
    writeFileSync(join(w.dataRoot, slugOf(w.proj), 'gate.json'), JSON.stringify({ mode: 'block' }))

    const first = handleStop({ cwd: w.proj, session_id: 'tg-1', transcript_path: w.transcript }, w.dataRoot)
    const ctx = first.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('страж тестов: tests/a.test.ts')
    expect(ctx).toContain('правился между упавшим и прошедшим прогоном')
    expect(ctx).toContain('утверждений стало меньше на 1')
    expect(first.decision).toBeUndefined() // наблюдение: откатом законной правки гейт не лечится
    const again = handleStop({ cwd: w.proj, session_id: 'tg-1', transcript_path: w.transcript }, w.dataRoot)
    expect(JSON.stringify(again)).not.toContain('страж тестов')

    // поимки считаются в гейт-потоке — их покажет /sym-status
    const db = openDb(join(w.dataRoot, slugOf(w.proj), 'passport.db'))
    const laws = (db.query("SELECT law FROM gate_log WHERE file='#тесты:tests/a.test.ts' ORDER BY law").all() as Array<{ law: string }>).map((r) => r.law)
    expect(laws).toEqual([TEST_LAWS.assertions, TEST_LAWS.bent].sort())
    // …но «правилом, которое здесь нарушают» наблюдение в сводке не становится
    for (const s of ['x1', 'x2', 'x3']) db.query('INSERT INTO gate_log(session_id, file, law) VALUES(?,?,?)').run(s, '#тесты:tests/a.test.ts', TEST_LAWS.bent)
    db.close()
    const summary = JSON.stringify(handleSessionStart({ cwd: w.proj, source: 'startup', session_id: 'tg-1b' }, w.dataRoot))
    expect(summary).not.toContain('нарушается регулярно')
    rmrf(w.proj)
    rmrf(w.dataRoot)
  })

  it('коммит внутри хода не прячет ослабление: сравнение идёт с базой сессии, а не с HEAD', () => {
    const w = world('tg-2')
    w.edit('tests/a.test.ts', bentTest)
    w.g('commit', '-am', 'правка теста')
    writeFileSync(w.transcript, [...run(RED), use('Edit', { file_path: join(w.proj, 'tests', 'a.test.ts') }), ...run(GREEN)].join('\n'))
    const out = handleStop({ cwd: w.proj, session_id: 'tg-2', transcript_path: w.transcript }, w.dataRoot)
    expect(JSON.stringify(out)).toContain('страж тестов: tests/a.test.ts')
    rmrf(w.proj)
    rmrf(w.dataRoot)
  })

  it('чинили код, тест рождён сессией, чистый ход — молчит', () => {
    const w = world('tg-3')
    w.edit('src/a.ts', 'export const total = (): number => 4\n')
    w.edit('tests/new.test.ts', "it('новое', () => {\n  expect(2).toBe(2)\n})\n")
    writeFileSync(
      w.transcript,
      [...run(RED), use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }), use('Write', { file_path: join(w.proj, 'tests', 'new.test.ts') }), ...run(GREEN)].join('\n'),
    )
    const out = handleStop({ cwd: w.proj, session_id: 'tg-3', transcript_path: w.transcript }, w.dataRoot)
    expect(JSON.stringify(out)).not.toContain('страж тестов')
    rmrf(w.proj)
    rmrf(w.dataRoot)
  })

  it('свой новый случай в старом файле, доведённый до зелёного, — не правка существовавшего теста', () => {
    const w = world('tg-5')
    const base = "import { total } from '../src/a'\nit('считает', () => {\n  expect(total()).toBe(3)\n  expect(total()).toBeGreaterThan(0)\n})\n"
    w.edit('tests/a.test.ts', base + "it('новое', () => {\n  expect(total() + 1).toBe(4)\n})\n")
    const file = join(w.proj, 'tests', 'a.test.ts')
    writeFileSync(
      w.transcript,
      [use('Read', { file_path: file }), ...run(RED), use('Edit', { file_path: file, old_string: '  expect(total() + 1).toBe(5)', new_string: '  expect(total() + 1).toBe(4)' }), ...run(GREEN)].join('\n'),
    )
    const out = handleStop({ cwd: w.proj, session_id: 'tg-5', transcript_path: w.transcript }, w.dataRoot)
    expect(JSON.stringify(out)).not.toContain('страж тестов')
    rmrf(w.proj)
    rmrf(w.dataRoot)
  })

  it('удалённый тест называется, только если удаляла эта сессия', () => {
    const w = world('tg-4')
    rmSync(join(w.proj, 'tests', 'old.test.ts'))
    writeFileSync(w.transcript, use('Bash', { command: 'ls tests' }))
    const silent = handleStop({ cwd: w.proj, session_id: 'tg-4', transcript_path: w.transcript }, w.dataRoot)
    expect(JSON.stringify(silent)).not.toContain('страж тестов') // удалил не наш транскрипт — авторство не подтверждено
    writeFileSync(w.transcript, use('Bash', { command: 'rm tests/old.test.ts' }))
    const named = handleStop({ cwd: w.proj, session_id: 'tg-4', transcript_path: w.transcript }, w.dataRoot)
    expect(JSON.stringify(named)).toContain('страж тестов: tests/old.test.ts')
    rmrf(w.proj)
    rmrf(w.dataRoot)
  })
})
