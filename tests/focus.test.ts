/**
 * Страж фокуса: расфокус виден из графа и диффов без токенов. Главное, что
 * проверяется, — ДИСЦИПЛИНА ШУМА: сфокусированная работа обязана проходить молча,
 * иначе страж превращается в «ревьюера, обязанного найти проблемы».
 */
import { describe, expect, it } from 'bun:test'
import { detectFocusDrift, renderFocus } from '../src/gates/focus'
import type { Edge } from '../src/graph/graph'

const chain: Edge[] = [
  { from: 'src/core/store.ts', to: 'src/core/ratings.ts' },
  { from: 'src/core/store.ts', to: 'src/core/schedule.ts' },
  { from: 'src/core/ratings.ts', to: 'src/core/facts.ts' },
  { from: 'src/hooks/stop.ts', to: 'src/core/store.ts' },
]

describe('молчание по умолчанию', () => {
  it('маленькая сессия не судится вовсе', () => {
    expect(detectFocusDrift({ sessionFiles: ['a.ts', 'b.ts', 'c.ts'], edges: chain })).toEqual([])
  })

  it('сфокусированная работа в одной зоне и одном окружении — тишина', () => {
    const files = [
      'src/core/store.ts',
      'src/core/ratings.ts',
      'src/core/schedule.ts',
      'src/core/facts.ts',
      'src/hooks/stop.ts',
      'src/core/salsa.ts',
    ]
    expect(detectFocusDrift({ sessionFiles: files, edges: chain })).toEqual([])
  })

  it('пустой граф не мешает — сигнал окружения просто не считается', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
    expect(detectFocusDrift({ sessionFiles: files, edges: [] })).toEqual([])
  })
})

describe('расползание по зонам', () => {
  it('одна задача в четырёх углах проекта — сигнал', () => {
    const files = ['app/a.vue', 'server/b.ts', 'docs/c.md', 'scripts/d.ts', 'tests/e.test.ts', 'app/f.vue']
    const signals = detectFocusDrift({ sessionFiles: files, edges: [] })
    expect(signals.length).toBe(1)
    expect(signals[0].kind).toContain('расползлась')
    expect(signals[0].detail).toContain('6 файлов в 5 зонах')
  })

  it('три зоны — ещё норма', () => {
    const files = ['app/a.vue', 'app/b.vue', 'server/c.ts', 'server/d.ts', 'tests/e.test.ts', 'tests/f.test.ts']
    expect(detectFocusDrift({ sessionFiles: files, edges: [] }).some((s) => s.kind.includes('расползлась'))).toBe(false)
  })
})

describe('правки вне окружения задачи', () => {
  it('половина диффа мимо начатого — сигнал с перечислением', () => {
    const files = [
      'src/core/store.ts', // сид
      'src/core/ratings.ts', // связан
      'app/landing.vue', // мимо
      'app/footer.vue', // мимо
      'docs/readme.md', // мимо
      'scripts/tool.ts', // мимо
    ]
    const signals = detectFocusDrift({ sessionFiles: files, edges: chain })
    const drift = signals.find((s) => s.kind.includes('вне окружения'))
    expect(drift).toBeDefined()
    expect(drift!.files).toContain('app/landing.vue')
    expect(drift!.detail).toContain('src/core/store.ts')
  })

  it('пара несвязанных файлов в большой сессии — шум, не сигнал', () => {
    const files = [
      'src/core/store.ts',
      'src/core/ratings.ts',
      'src/core/schedule.ts',
      'src/core/facts.ts',
      'src/hooks/stop.ts',
      'src/core/salsa.ts',
      'README.md', // единственный «чужой»
    ]
    expect(detectFocusDrift({ sessionFiles: files, edges: chain }).some((s) => s.kind.includes('вне окружения'))).toBe(false)
  })
})

describe('исчезнувшие проверки', () => {
  it('удаление теста из диффа — сигнал', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'tests/a.test.ts']
    const diffs = new Map([
      ['tests/a.test.ts', "@@\n-  it('проверяет вытеснение факта', () => {\n-    expect(x).toBe(1)\n-  })\n"],
    ])
    const signals = detectFocusDrift({ sessionFiles: files, edges: [], diffs })
    const stripped = signals.find((s) => s.kind.includes('проверки'))
    expect(stripped).toBeDefined()
    expect(stripped!.files).toContain('tests/a.test.ts')
  })

  it('добавление тестов сигналом не является', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'tests/a.test.ts']
    const diffs = new Map([['tests/a.test.ts', "@@\n+  it('новый тест', () => {\n+    expect(x).toBe(1)\n+  })\n"]])
    expect(detectFocusDrift({ sessionFiles: files, edges: [], diffs }).some((s) => s.kind.includes('проверки'))).toBe(false)
  })

  it('удалённый вызов регэкспа .test( — не удалённый тест', () => {
    // Правка «расширить регулярку» удаляет строку с `.test(` и добавляет такую
    // же. Без просмотра назад страж читал это как вынос проверки и тревожил
    // владельца на ровном месте — поймано на реальном диффе src/cli/elevate.ts.
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
    const diffs = new Map([['src/a.ts', "@@\n-const verb = args.find((a) => /^(one|two)$/.test(a))\n+const verb = args.find((a) => /^(one|two|three)$/.test(a))\n"]])
    expect(detectFocusDrift({ sessionFiles: files, edges: [], diffs }).some((s) => s.kind.includes('проверки'))).toBe(false)
  })

  it('вынос настоящей проверки из кода по-прежнему ловится', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
    const diffs = new Map([['src/a.ts', '@@\n-  expect(total).toBe(3)\n-  assert(ok)\n']])
    expect(detectFocusDrift({ sessionFiles: files, edges: [], diffs }).some((s) => s.kind.includes('проверки'))).toBe(true)
  })

  it('удаление обычного кода проверками не считается', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
    const diffs = new Map([['src/a.ts', '@@\n-const unused = 1\n-function old() {}\n']])
    expect(detectFocusDrift({ sessionFiles: files, edges: [], diffs })).toEqual([])
  })
})

describe('renderFocus', () => {
  it('подаёт фактом, без императивов и обвинений', () => {
    const lines = renderFocus([{ kind: 'работа расползлась по зонам', detail: '9 файлов в 5 зонах', files: [] }])
    expect(lines[0]).toContain('страж фокуса')
    expect(lines[0]).toContain('9 файлов в 5 зонах')
    expect(lines[0]).not.toMatch(/\b(нельзя|запрещено|обязан|немедленно)\b/i)
  })
})
