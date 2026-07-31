import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gatherInternals, buildGroundPrompt, runGround } from '../src/elevate/ground'

function project() {
  const root = mkdtempSync(join(tmpdir(), 'symbiont-ground-'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      dependencies: { drizzle: '1', zod: '1' },
      devDependencies: { vitest: '1' },
      scripts: { build: 'x', 'audit-content': 'node scripts/audit-content.mjs' },
    }),
  )
  writeFileSync(join(root, '.env.example', ), 'WORDSTAT_KEY=\nDATABASE_URL=\nSECRET_TOKEN=')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'x.ts'), "const k = process.env.OPENAI_API_KEY\nconst d = import.meta.env.APP_DEBUG\n")
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts', 'audit-content.mjs'), '// audit')
  writeFileSync(join(root, 'scripts', 'gen-og.mjs'), '// og')
  return root
}

describe('gatherInternals', () => {
  it('собирает deps/scripts/repoTools и ИМЕНА env-ключей (не значения)', () => {
    const root = project()
    const it_ = gatherInternals(root)
    expect(it_.deps).toEqual(expect.arrayContaining(['drizzle', 'zod', 'vitest']))
    expect(it_.scripts).toEqual(expect.arrayContaining(['build', 'audit-content']))
    expect(it_.repoTools).toEqual(expect.arrayContaining(['audit-content.mjs', 'gen-og.mjs']))
    // env — имена из .env.example и из ссылок кода
    expect(it_.envKeys).toEqual(expect.arrayContaining(['WORDSTAT_KEY', 'DATABASE_URL', 'OPENAI_API_KEY', 'APP_DEBUG']))
    rmrf(root)
  })

  it('НЕ читает значения секретов (в .env реальные значения игнорируются)', () => {
    const root = project()
    writeFileSync(join(root, '.env'), 'WORDSTAT_KEY=СЕКРЕТНОЕ_ЗНАЧЕНИЕ_12345')
    const it_ = gatherInternals(root)
    const serialized = JSON.stringify(it_)
    expect(serialized).not.toContain('СЕКРЕТНОЕ_ЗНАЧЕНИЕ_12345') // значение не утекло
    rmrf(root)
  })

  it('не-node проект (нет package.json) — пустые deps, не падение', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-ground-nonode-'))
    const it_ = gatherInternals(root)
    expect(it_.deps).toEqual([])
    rmrf(root)
  })
})

describe('buildGroundPrompt', () => {
  it('включает потребности, внутреннее, анти-карго-культ и требование источников', () => {
    const internals = { deps: ['zod'], scripts: ['build'], envKeys: ['WORDSTAT_KEY'], repoTools: ['audit-content.mjs'] }
    const p = buildGroundPrompt(['SEO: добавить schema.org', 'безопасность: валидация'], internals)
    expect(p).toContain('SEO: добавить schema.org')
    expect(p).toContain('WORDSTAT_KEY')
    expect(p).toContain('audit-content.mjs')
    expect(p).toContain('источником') // требование ссылок
    expect(p.toLowerCase()).toContain('карго') // анти-карго-культ
    expect(p).toContain('уже есть') // синтез с внутренним
  })
})

describe('runGround', () => {
  it('стаб-инструментальная модель: заземление проходит путь', () => {
    const root = project()
    const stub = () => ({ model: 'stub', text: 'SEO → schema-dts (источник: schema.org) → взять JSON-LD, синтез: использовать ваш скрипт gen-og.mjs' })
    const g = runGround(root, ['SEO: schema.org'], stub)
    expect(g.model).toBe('stub')
    expect(g.text).toContain('schema-dts')
    expect(g.internals.repoTools).toContain('gen-og.mjs')
    rmrf(root)
  })

  it('нет потребностей → пустой результат без вызова', () => {
    const root = project()
    let called = false
    const g = runGround(root, [], () => {
      called = true
      return { model: 'x', text: 'y' }
    })
    expect(called).toBe(false)
    expect(g.model).toBe(null)
    rmrf(root)
  })

  it('офлайн (caller вернул null) → деградация, не падение', () => {
    const root = project()
    const g = runGround(root, ['нужда'], () => null)
    expect(g.model).toBe(null)
    expect(g.text).toBe('')
    rmrf(root)
  })
})
