/**
 * Оси языковых пакетов: таблица знает, ЧТО измерять, а вердикт выводят числа
 * проекта. Проверяем обе стороны каждой оси — иначе легко получить счётчик,
 * который всегда показывает одну форму (перекрытие шаблонов, жадность), а
 * паспорт при этом уверенно выдаёт «закон».
 */
import { describe, it, expect } from 'bun:test'
import { countAxes, AXES } from '../src/miner/packs'
import { analyzeFile, aggregate } from '../src/miner/analyze'
import { deriveFacts } from '../src/miner/facts'

const counts = (ext: string, src: string, id: string): { a: number; b: number } =>
  countAxes(ext, src)[id] ?? { a: 0, b: 0 }

describe('оси языковых пакетов', () => {
  it('python: f-строки против .format и %', () => {
    const modern = counts('.py', 'x = f"{a} и {b}"\ny = f\'{c}\'\n', 'py-strings')
    expect(modern.a).toBe(2)
    expect(modern.b).toBe(0)
    const legacy = counts('.py', 'x = "{}".format(a)\ny = "%s" % b\n', 'py-strings')
    expect(legacy.a).toBe(0)
    expect(legacy.b).toBeGreaterThanOrEqual(2)
  })

  it('python: аннотации типов — многострочная сигнатура тоже считается', () => {
    const typed = counts('.py', 'def f(x: int) -> str:\n    return ""\n\nasync def g(\n    a: int,\n) -> None:\n    pass\n', 'py-typing')
    expect(typed).toEqual({ a: 2, b: 0 })
    const plain = counts('.py', 'def f(self):\n    pass\n\ndef g(a, b=1):\n    pass\n', 'py-typing')
    expect(plain).toEqual({ a: 0, b: 2 })
  })

  it('php: короткие массивы против array()', () => {
    expect(counts('.php', "<?php $a = ['x' => 1]; $b = [1, 2];", 'php-array')).toEqual({ a: 2, b: 0 })
    expect(counts('.php', "<?php $a = array('x' => 1); $b = array(1);", 'php-array')).toEqual({ a: 0, b: 2 })
  })

  it('php: обращение к массиву — не создание массива (иначе легаси выглядит современным)', () => {
    // Найдено замером на WordPress: 11871 обращений вида $x['…'] против 4182
    // настоящих array() давали ложный вердикт «короткий синтаксис — 86%»
    expect(counts('.php', "<?php echo $row['name']; $v = $cfg['a']['b']; $t = foo()['x'];", 'php-array')).toEqual({ a: 0, b: 0 })
    expect(counts('.php', "<?php $out = ['a' => $row['name']];", 'php-array')).toEqual({ a: 1, b: 0 })
  })

  it('php: строгое сравнение не путается с нестрогим (перекрытие == внутри ===)', () => {
    expect(counts('.php', '<?php if ($a === $b && $c !== $d) {}', 'php-eq')).toEqual({ a: 2, b: 0 })
    expect(counts('.php', '<?php if ($a == $b || $c != $d) {}', 'php-eq')).toEqual({ a: 0, b: 2 })
  })

  it('go: := против var и приёмник на указателе против значения', () => {
    expect(counts('.go', 'x := 1\ny := f()\nvar z int\n', 'go-decl')).toEqual({ a: 2, b: 1 })
    expect(counts('.go', 'func (s *Server) A() {}\nfunc (c Config) B() {}\n', 'go-receiver')).toEqual({ a: 1, b: 1 })
  })

  it('kotlin и rust: неизменяемость', () => {
    expect(counts('.kt', 'val a = 1\nval b = 2\nvar c = 3\n', 'kt-binding')).toEqual({ a: 2, b: 1 })
    expect(counts('.rs', 'let mut a = 1;\nlet b = 2;\n', 'rs-binding')).toEqual({ a: 1, b: 1 })
  })

  it('c#/java: var против явного типа', () => {
    expect(counts('.cs', 'var a = new List<int>();\nList<int> b = new List<int>();\nint c = 1;\n', 'clike-local-type')).toEqual({ a: 1, b: 2 })
  })

  it('ось не срабатывает на чужом расширении', () => {
    expect(countAxes('.ts', 'const a = [1, 2]\nif (a === b) {}')).toEqual({})
    expect(countAxes('.md', 'array( ) := val')).toEqual({})
  })

  it('вердикт по оси приходит в факты и берёт сторону большинства', () => {
    const obs = [
      analyzeFile('a.py', '.py', 'x = f"{a}"\n'.repeat(9) + 'y = "{}".format(b)\n'),
      analyzeFile('b.py', '.py', 'z = f"{c}"\n'.repeat(5)),
    ]
    const facts = deriveFacts(aggregate(obs, ['.py', '.py']))
    const strings = facts.find((f) => f.area === 'строки')
    expect(strings?.statement).toBe('подстановка в строки — f-строки')
    expect(strings?.total).toBe(15)
    expect(strings?.positive).toBe(14)
    expect(strings?.tier).toBe('привычка')
  })

  it('редкая ось молчит: наблюдений меньше порога — факта нет', () => {
    const obs = [analyzeFile('a.py', '.py', 'x = f"{a}"\n')]
    const facts = deriveFacts(aggregate(obs, ['.py']))
    expect(facts.find((f) => f.area === 'строки')).toBeUndefined()
  })

  it('таблица осей непротиворечива: id уникальны, пороги разумны, метки различны', () => {
    const ids = AXES.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of AXES) {
      expect(a.min).toBeGreaterThanOrEqual(5)
      expect(a.labelA).not.toBe(a.labelB)
      expect(a.all.flags).toContain('g')
      expect(a.exts.every((e) => e.startsWith('.'))).toBe(true)
    }
  })
})

/**
 * Присутствие языка. Наблюдения ось набирает с ФАЙЛОВ, и плотный чужой файл
 * легко перевешивает по числу наблюдений весь остальной проект: шесть
 * PHP-файлов в Python-репозитории выдали «массивы — короткий синтаксис []»
 * законом всего репозитория — рядом с отступами, намайненными со всей базы,
 * и неотличимо от них.
 */
describe('конвенции языка требуют присутствия языка в проекте', () => {
  const PHP = '<?php\n$a = [1, 2];\n$b = [3, 4];\n$c = [5, 6];\n$d = [7, 8];\n$e = [9, 0];\n'
  const PY = 'def f(x: int) -> str:\n    return ""\n'

  const world = (pyFiles: number, phpFiles: number): ReturnType<typeof aggregate> => {
    const obs: ReturnType<typeof analyzeFile>[] = []
    const exts: string[] = []
    for (let i = 0; i < pyFiles; i++) {
      obs.push(analyzeFile(`m${i}.py`, '.py', PY))
      exts.push('.py')
    }
    for (let i = 0; i < phpFiles; i++) {
      obs.push(analyzeFile(`p${i}.php`, '.php', PHP.repeat(3)))
      exts.push('.php')
    }
    return aggregate(obs, exts)
  }

  it('язык-гость молчит: наблюдений хватает, файлов — нет', () => {
    const agg = world(180, 6) // 1.6% файлов, как в разобранном паспорте
    expect(agg.axes['php-array']!.a).toBeGreaterThanOrEqual(20) // наблюдения есть
    expect(deriveFacts(agg).find((f) => f.area === 'массивы')).toBeUndefined()
  })

  it('язык проекта говорит: доли хватает', () => {
    const agg = world(50, 6) // 10.7% файлов
    expect(deriveFacts(agg).find((f) => f.area === 'массивы')?.statement).toBe('массивы — короткий синтаксис []')
  })

  it('малая доля в большом проекте — но сотня файлов: язык говорит', () => {
    const agg = world(3000, 40) // 1.3% файлов, зато сорок штук
    expect(deriveFacts(agg).find((f) => f.area === 'массивы')?.statement).toBe('массивы — короткий синтаксис []')
  })
})
