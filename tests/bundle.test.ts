/**
 * Бандл (долг №16): чистое ядро сборки — переписывание ссылок на форму поставки,
 * полнота точек входа против реальных манифестов/скиллов, инвариант плоского
 * dist, детерминизм хэша свежести.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ENTRY_SOURCES, collectBundleInputs, bundleInputsHash, rewriteEntryPaths } from '../src/bundle/core'
import { EXT_LANG, grammarNames } from '../src/layer1/ast'

const ROOT = join(import.meta.dirname, '..')

describe('rewriteEntryPaths', () => {
  it('переписывает хуки, MCP и CLI-ссылки скиллов на dist/*.js', () => {
    expect(rewriteEntryPaths('${CLAUDE_PLUGIN_ROOT}/src/hooks/session-start.ts')).toBe('${CLAUDE_PLUGIN_ROOT}/dist/session-start.js')
    expect(rewriteEntryPaths('${CLAUDE_PLUGIN_ROOT}/src/mcp/server.ts')).toBe('${CLAUDE_PLUGIN_ROOT}/dist/server.js')
    expect(rewriteEntryPaths('bun run "${CLAUDE_SKILL_DIR}/../../src/cli/auto-learn.ts" x')).toBe('bun run "${CLAUDE_SKILL_DIR}/../../dist/auto-learn.js" x')
  })

  it('не трогает прочие пути и идемпотентен', () => {
    const other = 'см. src/passport/build.ts и tests/store.test.ts'
    expect(rewriteEntryPaths(other)).toBe(other)
    const once = rewriteEntryPaths('src/cli/status.ts')
    expect(rewriteEntryPaths(once)).toBe(once)
  })
})

describe('ENTRY_SOURCES', () => {
  it('каждый вход существует на диске', () => {
    for (const e of ENTRY_SOURCES) expect(existsSync(join(ROOT, e))).toBe(true)
  })

  it('basename уникальны — инвариант плоского dist', () => {
    const names = ENTRY_SOURCES.map((e) => e.replace(/^.*\//, ''))
    expect(new Set(names).size).toBe(names.length)
  })

  it('покрывают все ссылки hooks.json, .mcp.json и скиллов', () => {
    const covered = new Set(ENTRY_SOURCES)
    const refs = [
      ...readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8').matchAll(/src\/(?:hooks|cli|mcp)\/[\w-]+\.ts/g),
      ...readFileSync(join(ROOT, '.mcp.json'), 'utf8').matchAll(/src\/(?:hooks|cli|mcp)\/[\w-]+\.ts/g),
    ].map((m) => m[0])
    for (const dir of readdirSync(join(ROOT, 'skills'))) {
      const p = join(ROOT, 'skills', dir, 'SKILL.md')
      if (!existsSync(p)) continue
      for (const m of readFileSync(p, 'utf8').matchAll(/src\/cli\/[\w-]+\.ts/g)) refs.push(m[0])
    }
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) expect(covered.has(r)).toBe(true)
  })
})

describe('grammarNames', () => {
  it('уникальны и покрывают каждое значение EXT_LANG', () => {
    const names = grammarNames()
    expect(new Set(names).size).toBe(names.length)
    for (const v of Object.values(EXT_LANG)) expect(names).toContain(v)
    expect(names).toContain('javascript')
  })
})

describe('bundleInputsHash', () => {
  it('детерминирован и чувствителен к содержимому', () => {
    const a = [
      { path: 'a.ts', content: 'x' },
      { path: 'b.ts', content: 'y' },
    ]
    expect(bundleInputsHash(a)).toBe(bundleInputsHash([...a]))
    expect(bundleInputsHash(a)).not.toBe(bundleInputsHash([a[0], { path: 'b.ts', content: 'z' }]))
    // связка путь+содержимое: перенос содержимого между файлами меняет хэш
    expect(bundleInputsHash(a)).not.toBe(
      bundleInputsHash([
        { path: 'a.ts', content: 'y' },
        { path: 'b.ts', content: 'x' },
      ]),
    )
  })
})

describe('collectBundleInputs', () => {
  it('собирает исходники и манифесты, отсортирован, без node_modules/plugin', () => {
    const inputs = collectBundleInputs(ROOT)
    const paths = inputs.map((i) => i.path)
    expect(paths).toContain('src/passport/build.ts')
    expect(paths).toContain('hooks/hooks.json')
    expect(paths).toContain('.claude-plugin/plugin.json')
    expect(paths.some((p) => p.startsWith('skills/'))).toBe(true)
    expect(paths.some((p) => p.includes('node_modules') || p.startsWith('plugin/'))).toBe(false)
    const sorted = [...paths].sort()
    expect(paths).toEqual(sorted)
  })
})

describe('хэш свежести не зависит от операционной системы', () => {
  it('CRLF и LF дают один и тот же хэш', () => {
    // Первый прогон CI лёг именно здесь: артефакт собирался на Windows (CRLF в
    // рабочей копии), а проверялся в Linux (LF из git по .gitattributes) — и
    // считался несвежим, хотя не менялся ни на байт.
    const lf = [{ path: 'a.ts', content: "const a = 1\nconst b = 2\n" }]
    const crlf = [{ path: 'a.ts', content: "const a = 1\r\nconst b = 2\r\n" }]
    expect(bundleInputsHash(crlf)).toBe(bundleInputsHash(lf))
  })

  it('содержательная правка хэш всё-таки меняет', () => {
    const a = [{ path: 'a.ts', content: 'const a = 1\n' }]
    const b = [{ path: 'a.ts', content: 'const a = 2\n' }]
    expect(bundleInputsHash(a)).not.toBe(bundleInputsHash(b))
  })
})
