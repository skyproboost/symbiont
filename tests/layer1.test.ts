import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { fileMetrics, addMetrics, zeroMetrics } from '../src/layer1/ast'
import { deriveAstFacts } from '../src/layer1/facts1'
import { runLayer1 } from '../src/layer1/run'
import { FactStore } from '../src/core/store'

describe('fileMetrics (tree-sitter)', () => {
  it('TypeScript: try/catch/throw/async/классы считаются точно', async () => {
    const src = [
      'async function a() { try { x() } catch (e) { return null } }',
      'function b() { try { y() } catch (e) {} }', // пустой catch
      'const c = async () => { throw new Error("x") }',
      'class D { m() { try { z() } catch (e) { throw e } } }',
    ].join('\n')
    const m = (await fileMetrics('.ts', src))!
    expect(m.tryCount).toBe(3)
    expect(m.catchCount).toBe(3)
    expect(m.emptyCatch).toBe(1)
    expect(m.catchWithReturn).toBe(1)
    expect(m.catchWithRethrow).toBe(1)
    expect(m.throwCount).toBe(2) // throw в стрелке + re-throw в catch
    expect(m.classCount).toBe(1)
    expect(m.fnAsync).toBe(2)
    expect(m.fnTotal).toBeGreaterThanOrEqual(4)
  })

  it('Python: except/raise распознаются той же нормализацией', async () => {
    const src = 'def f():\n    try:\n        g()\n    except Exception as e:\n        raise\n'
    const m = await fileMetrics('.py', src)
    if (m === null) return // грамматики может не быть в пребилдах — деградация честна
    expect(m.tryCount).toBe(1)
    expect(m.catchCount).toBe(1)
    expect(m.throwCount).toBeGreaterThanOrEqual(1)
  })

  it('vue: парсится только <script>-блок', async () => {
    const m = (await fileMetrics('.vue', '<template><div/></template>\n<script setup>\ntry { a() } catch (e) { return }\n</script>'))!
    expect(m.tryCount).toBe(1)
  })

  it('неизвестное расширение — null (слой молчит)', async () => {
    expect(await fileMetrics('.xyz', 'x')).toBe(null)
  })
})

describe('deriveAstFacts', () => {
  it('катехизис ошибок: пустые catch, возврат из catch, throw-стиль', () => {
    const m = { ...zeroMetrics(), tryCount: 40, catchCount: 40, emptyCatch: 0, catchWithReturn: 34, catchWithRethrow: 2, throwCount: 1 }
    const st = deriveAstFacts(m).map((f) => f.statement)
    expect(st.join(' ')).toContain('пустые catch-блоки — не встречаются')
    expect(st.join(' ')).toContain('возвращаются значением')
    expect(st.join(' ')).toContain('свои не бросаются')
  })

  it('малая выборка — молчание, не гадание', () => {
    const m = { ...zeroMetrics(), tryCount: 3, catchCount: 3, emptyCatch: 3 }
    expect(deriveAstFacts(m)).toEqual([])
  })

  it('функциональный стиль: классов ноль при 20+ функциях', () => {
    const m = { ...zeroMetrics(), fnTotal: 50, fnAsync: 2, classCount: 0 }
    const st = deriveAstFacts(m).map((f) => f.statement)
    expect(st.join(' ')).toContain('классы — не используются')
    expect(st.join(' ')).toContain('async-функции — почти не используются')
  })
})

describe('runLayer1 — инкрементальный прогон', () => {
  it('полный цикл: вердикт, кэш, смена стиля, отзыв', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-l1-proj-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-l1-data-'))
    const FILE = 'export function f(i) {\n  try { risky(i) } catch (e) { return null }\n  try { more(i) } catch (e) { return 0 }\n}\n'
    for (let i = 0; i < 8; i++) writeFileSync(join(proj, `m${i}.ts`), FILE)

    const r1 = await runLayer1(proj, dataDir)
    expect(r1.parsed).toBe(8)
    expect(r1.pending).toBe(0)
    expect(r1.asserted).toBe(true)
    expect(r1.facts.map((f) => f.statement).join(' ')).toContain('возвращаются значением')

    // повтор: всё из кэша, журнал не тронут (подтверждения не накачиваются)
    const r2 = await runLayer1(proj, dataDir)
    expect(r2.parsed).toBe(0)
    expect(r2.fromCache).toBe(8)
    expect(r2.asserted).toBe(false)

    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const l1facts = new FactStore(db).active().filter((f) => f.source === 'miner:layer1')
    db.close()
    expect(l1facts.length).toBeGreaterThan(0)
    for (const f of l1facts) expect(f.confirmations).toBe(0)

    // смена стиля: теперь всё пробрасывается
    const RETHROW = 'export function f(i) {\n  try { risky(i) } catch (e) { throw e }\n  try { more(i) } catch (e) { throw e }\n}\n'
    for (let i = 0; i < 8; i++) writeFileSync(join(proj, `m${i}.ts`), RETHROW)
    const r3 = await runLayer1(proj, dataDir)
    expect(r3.asserted).toBe(true)
    const db2 = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const active = new FactStore(db2).active().filter((f) => f.source === 'miner:layer1')
    db2.close()
    const st = active.map((f) => f.statement).join(' ')
    expect(st).toContain('пробрасываются')
    expect(st).not.toContain('возвращаются значением') // старый вердикт вытеснен/отозван

    rmrf(proj)
    rmrf(dataDir)
  })

  it('бюджет 0мс: ничего не парсится, вердикта нет, следующий заход дожёвывает', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-l1-bud-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-l1-budd-'))
    const FILE = 'export function f() {\n  try { r() } catch (e) { return null }\n}\n'
    for (let i = 0; i < 5; i++) writeFileSync(join(proj, `m${i}.ts`), FILE)

    const r1 = await runLayer1(proj, dataDir, 0)
    expect(r1.pending).toBe(5)
    expect(r1.asserted).toBe(false)

    const r2 = await runLayer1(proj, dataDir) // без бюджета — дожевал
    expect(r2.parsed).toBe(5)
    expect(r2.pending).toBe(0)

    rmrf(proj)
    rmrf(dataDir)
  })
})
