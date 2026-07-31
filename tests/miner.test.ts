import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeJs, detectIndent, analyzeFile, aggregate, splitParams } from '../src/miner/analyze'
import { deriveFacts, tierOf } from '../src/miner/facts'
import { walkFiles, codeFiles } from '../src/miner/walk'
import { readFileSync } from 'node:fs'

// ── Стиль «рабочего проекта» владельца: var, венгерская нотация, _параметры, без стрелочных и fmr
const LEGACY_STYLE = `
function processOrder(_oOrder, _aItems) {
    var sName = _oOrder.name;
    var aResult = [];
    var nTotal = 0;
    for (var i = 0; i < _aItems.length; i++) {
        var oItem = _aItems[i];
        nTotal = nTotal + oItem.price;
        aResult.push(oItem);
    }
    var bValid = nTotal > 0;
    return { sName: sName, nTotal: nTotal, bValid: bValid };
}
function formatPrice(_nPrice) {
    var sPrice = String(_nPrice);
    return sPrice;
}
`

// ── Современный стиль (как labreadai): const/let, стрелочные, fmr, 2 пробела
const MODERN_STYLE = `
const items = list.filter((x) => x.active).map((x) => x.id)
const total = items.reduce((sum, id) => sum + id, 0)
const formatName = (user) => {
  const { first, last } = user
  let result = ''
  if (first) {
    result = first + ' ' + last
  }
  return result
}
`

describe('analyzeJs', () => {
  it('легаси-стиль: var, венгерская нотация, _параметры, без стрелочных', () => {
    const s = analyzeJs(LEGACY_STYLE)
    expect(s.decl.var).toBeGreaterThan(5)
    expect(s.decl.const).toBe(0)
    expect(s.decl.let).toBe(0)
    expect(s.fn.arrow).toBe(0)
    expect(s.fn.decl).toBe(2)
    expect(s.fmr.filter + s.fmr.map + s.fmr.reduce).toBe(0)
    expect(s.fmr.forLoops).toBe(1)
    expect(s.params.underscore).toBe(3)
    expect(s.params.plain).toBe(0)
    // Венгерские префиксы: s/a/n/o/b
    const prefixes = Object.keys(s.hungarianPrefixes)
    expect(prefixes).toContain('s')
    expect(prefixes).toContain('a')
    expect(prefixes).toContain('n')
  })

  it('современный стиль: const/let, стрелочные, fmr, деструктуризация', () => {
    const s = analyzeJs(MODERN_STYLE)
    expect(s.decl.var).toBe(0)
    expect(s.decl.const + s.decl.let).toBeGreaterThan(3)
    expect(s.fn.arrow).toBeGreaterThan(2)
    expect(s.fmr.filter).toBe(1)
    expect(s.fmr.map).toBe(1)
    expect(s.fmr.reduce).toBe(1)
  })

  it('комментарии не считаются', () => {
    const s = analyzeJs('// var sFake = 1\n/* var sFake2 = 2 */\nconst real = 3')
    expect(s.decl.var).toBe(0)
    expect(s.decl.const).toBe(1)
  })

  it('точки с запятой: только явные statement-строки', () => {
    const withSemi = Array.from({ length: 10 }, (_, i) => `var x${i} = ${i};`).join('\n')
    const noSemi = Array.from({ length: 10 }, (_, i) => `const x${i} = ref(${i})`).join('\n')
    expect(analyzeJs(withSemi).semiLines).toEqual({ with: 10, without: 0 })
    expect(analyzeJs(noSemi).semiLines).toEqual({ with: 0, without: 10 })
    // строки с незавершённым хвостом не считаются
    expect(analyzeJs('const a = {\nconst b = [\n').semiLines).toEqual({ with: 0, without: 0 })
  })

  it('кавычки: одинарные против двойных', () => {
    const s = analyzeJs(`const a = 'x'; const b = 'y'; const c = 'z'; const d = "w";`)
    expect(s.quotes.single).toBe(3)
    expect(s.quotes.double).toBe(1)
  })
})

describe('detectIndent', () => {
  const block = (indent: string) =>
    Array.from({ length: 10 }, (_, i) => `${i % 2 ? indent : indent + indent}line${i} {`).join('\n')

  it('2 пробела', () => {
    expect(detectIndent('a {\n' + block('  ') + '\n}')).toBe('s2')
  })
  it('4 пробела', () => {
    expect(detectIndent('a {\n' + block('    ') + '\n}')).toBe('s4')
  })
  it('табы', () => {
    expect(detectIndent('a {\n' + block('\t') + '\n}')).toBe('tab')
  })
  it('слишком мало данных — null', () => {
    expect(detectIndent('const a = 1')).toBe(null)
  })
})

describe('tierOf', () => {
  it('закон требует ≥95% и ≥30 наблюдений', () => {
    expect(tierOf(0.99, 100)).toBe('закон')
    expect(tierOf(0.99, 10)).not.toBe('закон')
    expect(tierOf(0.8, 100)).toBe('привычка')
    expect(tierOf(0.6, 100)).toBe('гипотеза')
    expect(tierOf(0.4, 100)).toBe('нет консенсуса')
  })
})

describe('другие языки (универсальные анализаторы)', () => {
  const PYTHON = 'def main():\n' + Array.from({ length: 12 }, (_, i) => (i % 2 ? '    x = 1' : '        y = 2')).join('\n')

  it('walker видит .py/.go/.php', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-lang-'))
    writeFileSync(join(dir, 'a.py'), PYTHON)
    writeFileSync(join(dir, 'b.go'), 'package main\nfunc main() {\n\tx := 1\n}\n')
    writeFileSync(join(dir, 'c.php'), '<?php\n$a = 1;\n')
    const files = codeFiles(walkFiles(dir))
    expect(files.length).toBe(3)
    rmrf(dir, { recursive: true, force: true })
  })

  it('python: отступы детектятся, JS-пакет не срабатывает', () => {
    const o = analyzeFile('a.py', '.py', PYTHON)
    expect(o.indent).toBe('s4')
    expect(o.js.decl.var + o.js.decl.const + o.js.decl.let).toBe(0)
  })
})

describe('именование: имя судится по существу, а не по подчёркиваниям и повторам', () => {
  it('приватное поле _body — не snake_case (C#/JS-идиома, а не стиль имени)', () => {
    const o = analyzeFile('P.cs', '.cs', 'void Start() {\n    _body = GetComponent();\n    _rigidBody = null;\n}\n')
    expect(o.js.naming.snake).toBe(0)
    // body → plain, rigidBody → camel: подчёркивание отброшено, суть осталась
    expect(o.js.naming.plain + o.js.naming.camel).toBe(2)
  })

  it('_user_id — всё ещё snake_case: подчёркивание ВНУТРИ имени остаётся сигналом', () => {
    const o = analyzeFile('a.py', '.py', '_user_id = 1\n')
    expect(o.js.naming.snake).toBe(1)
  })

  it('одно имя, сто повторов — одно наблюдение (иначе повтор штампует ложный закон)', () => {
    const repeated = 'void Tick() {\n    _body = GetComponent();\n}\n'.repeat(50)
    const o = analyzeFile('P.cs', '.cs', repeated)
    const total = o.js.naming.camel + o.js.naming.snake + o.js.naming.plain + o.js.naming.pascal
    expect(total).toBe(1)
  })

  it('разные имена считаются все — сигнал словаря не теряется', () => {
    const o = analyzeFile('a.js', '.js', 'const alpha = 1\nconst betaOne = 2\nconst gamma_two = 3\nfunction Delta() {}\n')
    expect(o.js.naming.plain).toBe(1)
    expect(o.js.naming.camel).toBe(1)
    expect(o.js.naming.snake).toBe(1)
    expect(o.js.naming.pascal).toBe(1)
  })
})

describe('симуляция: синтетический легаси-проект', () => {
  const dir = mkdtempSync(join(tmpdir(), 'symbiont-sim-'))
  // 6 файлов легаси-стиля + шумовые каталоги, которые должны игнорироваться
  for (let i = 0; i < 6; i++) writeFileSync(join(dir, `module${i}.js`), LEGACY_STYLE.repeat(6))
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'lib.js'), MODERN_STYLE.repeat(50))
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, '.git', 'x.js'), MODERN_STYLE)

  it('node_modules и .git игнорируются', () => {
    const files = codeFiles(walkFiles(dir))
    expect(files.length).toBe(6)
  })

  it('виртуальное окружение — такие же чужие зависимости, как node_modules', () => {
    // Замер на боевом проекте: рядом с Nuxt-приложением из трёх файлов лежал
    // venv на 13 365 .py, и паспорт описывал pandas, а не проект владельца
    const world = mkdtempSync(join(tmpdir(), 'symbiont-venv-'))
    writeFileSync(join(world, 'main.py'), 'def run():\n    return 1\n')
    for (const noise of ['venv/Lib/site-packages/numpy', '__pycache__', 'Pods']) {
      mkdirSync(join(world, ...noise.split('/')), { recursive: true })
      writeFileSync(join(world, ...noise.split('/'), 'x.py'), 'def x():\n    return 2\n')
    }
    expect(codeFiles(walkFiles(world)).length).toBe(1)
    rmrf(world)
  })

  it('выводит законы легаси-проекта: var, без стрелочных, венгерская, _параметры', () => {
    const files = codeFiles(walkFiles(dir))
    const obs = files.map((f) => analyzeFile(f.path, f.ext, readFileSync(f.path, 'utf8')))
    const facts = deriveFacts(aggregate(obs, files.map((f) => f.ext)))
    const laws = facts.filter((f) => f.tier === 'закон').map((f) => f.statement)

    expect(laws.some((s) => s.includes('только var'))).toBe(true)
    expect(laws.some((s) => s.includes('стрелочные функции — не используются'))).toBe(true)
    expect(laws.some((s) => s.includes('венгерская нотация'))).toBe(true)
    expect(laws.some((s) => s.includes('префиксом _'))).toBe(true)
    expect(laws.some((s) => s.includes('filter/map/reduce — не используются'))).toBe(true)
  })

  it('современный проект даёт противоположные факты', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'symbiont-sim2-'))
    for (let i = 0; i < 6; i++) writeFileSync(join(dir2, `mod${i}.ts`), MODERN_STYLE.repeat(6))
    const files = codeFiles(walkFiles(dir2))
    const obs = files.map((f) => analyzeFile(f.path, f.ext, readFileSync(f.path, 'utf8')))
    const facts = deriveFacts(aggregate(obs, files.map((f) => f.ext)))
    const statements = facts.map((f) => f.statement)

    expect(statements.some((s) => s.includes('const/let'))).toBe(true)
    expect(statements.some((s) => s.includes('стрелочные функции — используются'))).toBe(true)
    expect(statements.some((s) => s.includes('венгерская нотация'))).toBe(false)
    rmrf(dir2, { recursive: true, force: true })
  })

  it('cleanup', () => {
    rmrf(dir, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})

describe('разбор списка параметров: запятая внутри типа — не разделитель', () => {
  it('дженерик не рвётся: (a: Map<string, number>, b) — два параметра', () => {
    expect(splitParams('a: Map<string, number>, b: string')).toEqual(['a: Map<string, number>', ' b: string'])
  })

  it('деструктуризация — один параметр, а не по одному на поле', () => {
    const o = analyzeFile('a.ts', '.ts', 'function g({ x, y }: Point, c: number) { return c }')
    expect(o.js.destructuredParams).toBe(1)
    expect(o.js.params.plain).toBe(1) // только c; x и y — поля, а не параметры
  })

  it('функция-тип в параметре не обрывает захват: (cb: () => void, x) — два', () => {
    const o = analyzeFile('a.ts', '.ts', 'function h(cb: () => void, x: number) { return x }')
    expect(o.js.params.plain).toBe(2)
  })

  it('случай из замечания целиком: три параметра, один деструктурированный', () => {
    const o = analyzeFile('a.ts', '.ts', 'function m(a: Map<string, number>, { x, y }: P, c = [1, 2]) { return a }')
    expect(o.js.params.plain + o.js.destructuredParams).toBe(3)
    expect(o.js.destructuredParams).toBe(1)
  })

  it('стрелка ВНУТРИ вызова не теряется — там живёт почти вся деструктуризация', () => {
    const o = analyzeFile('a.ts', '.ts', 'const r = files.map(({ file, ext }) => file + ext)\n')
    expect(o.js.destructuredParams).toBe(1)
  })

  it('строковый литерал с запятой параметром не становится', () => {
    expect(splitParams('a = "x, y", b')).toEqual(['a = "x, y"', ' b'])
  })
})
