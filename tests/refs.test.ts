/**
 * Рёбра по ссылкам на имена типов (форма name) и производные зоны обхода.
 *
 * Боевой случай: Yii 1.x — 2423 своих .php, из них require в 3 файлах, use в
 * 32; код связан автозагрузкой по имени класса, service locator'ом и строками
 * классов в конфигах/AR-relations. Граф импортов на таком стеке — точки без
 * рёбер, а вендорный protected/vendors/ (множественное написание) вдобавок
 * захватывал карту проекта. Здесь закреплены оба механизма защиты.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { rmrf } from './_helpers'
import { buildEdges } from '../src/graph/graph'
import { walkFiles, inDerivedZone } from '../src/miner/walk'

const edgeSet = (files: Array<{ rel: string; content: string }>): string[] =>
  buildEdges(files).edges.map((e) => `${e.from}→${e.to}`).sort()

describe('php: рёбра без импортов — автозагрузка по имени класса (Yii 1.x)', () => {
  it('extends, статический вызов, new, строка класса в конфиге и relations', () => {
    const e = edgeSet([
      { rel: 'protected/components/ActiveRecord.php', content: '<?php class ActiveRecord {}' },
      { rel: 'protected/models/UserAro.php', content: '<?php class UserAro extends ActiveRecord {}' },
      {
        rel: 'protected/models/PackageAro.php',
        content: "<?php\nclass PackageAro extends ActiveRecord {\n  public function relations() {\n    return array('user' => array(self::BELONGS_TO, 'UserAro', 'user_id'));\n  }\n}",
      },
      {
        rel: 'protected/controllers/PackageController.php',
        content: "<?php\nclass PackageController extends Controller {\n  public function actionSplit($id) {\n    $o = ShipmentAro::model()->findByPk($id);\n    Yii::app()->history->push(new PackageArrivedEvent($o));\n  }\n}",
      },
      { rel: 'protected/components/PackageArrivedEvent.php', content: '<?php class PackageArrivedEvent {}' },
      { rel: 'protected/models/ShipmentAro.php', content: '<?php class ShipmentAro extends ActiveRecord {}' },
      {
        rel: 'protected/config/main.php',
        content: "<?php return array('components' => array('history' => array('class' => 'HistoryComponent')));",
      },
      { rel: 'protected/components/HistoryComponent.php', content: '<?php class HistoryComponent {}' },
    ])
    // Controller и Yii проектом не объявлены (фреймворк) — рёбер к ним нет
    expect(e).toEqual([
      'protected/config/main.php→protected/components/HistoryComponent.php',
      'protected/controllers/PackageController.php→protected/components/PackageArrivedEvent.php',
      'protected/controllers/PackageController.php→protected/models/ShipmentAro.php',
      'protected/models/PackageAro.php→protected/components/ActiveRecord.php',
      'protected/models/PackageAro.php→protected/models/UserAro.php',
      'protected/models/ShipmentAro.php→protected/components/ActiveRecord.php',
      'protected/models/UserAro.php→protected/components/ActiveRecord.php',
    ].sort())
  })

  it('голое имя в namespace-файле живёт в СВОЁМ пространстве, а не в чужом', () => {
    const e = edgeSet([
      { rel: 'src/Admin/Report.php', content: '<?php\nnamespace App\\Admin;\nclass Report { public function run() { $b = new Builder(); } }' },
      { rel: 'src/Admin/Builder.php', content: '<?php\nnamespace App\\Admin;\nclass Builder {}' },
      { rel: 'src/Site/Builder.php', content: '<?php\nnamespace App\\Site;\nclass Builder {}' },
    ])
    expect(e).toEqual(['src/Admin/Report.php→src/Admin/Builder.php'])
  })

  it('голая строка разрешается только в глобальный тип — надпись не ловит App\\Active', () => {
    // Класс в пространстве недостижим по голой строке и для автозагрузчика
    expect(edgeSet([
      { rel: 'src/View.php', content: "<?php\nnamespace App;\nclass View { public $label = 'Active'; }" },
      { rel: 'src/Active.php', content: '<?php\nnamespace App;\nclass Active {}' },
    ])).toEqual([])
    // Глобальный класс строкой — ребро есть (конфиги, фабрики)
    expect(edgeSet([
      { rel: 'legacy/form.php', content: "<?php $widget = 'DatePicker';" },
      { rel: 'legacy/DatePicker.php', content: '<?php class DatePicker {}' },
    ])).toEqual(['legacy/form.php→legacy/DatePicker.php'])
  })

  it('точечный алиас Yii: application.components.Foo — класс это последний сегмент', () => {
    expect(edgeSet([
      { rel: 'protected/config/main.php', content: "<?php return array('preload' => array('application.components.Notifier'));" },
      { rel: 'protected/components/Notifier.php', content: '<?php class Notifier {}' },
    ])).toEqual(['protected/config/main.php→protected/components/Notifier.php'])
  })

  it('тайп-хинты дают рёбра, встроенные типы и ключевые слова — нет', () => {
    const e = edgeSet([
      {
        rel: 'app.php',
        content: '<?php\nfunction handle(int $x, User $u): ?Report {\n  try { $d = new DateTime(); } catch (Exception $e) { return null; }\n  return new Report();\n}',
      },
      { rel: 'User.php', content: '<?php class User {}' },
      { rel: 'Report.php', content: '<?php class Report {}' },
    ])
    expect(e).toEqual(['app.php→Report.php', 'app.php→User.php'])
  })

  it('ссылка в комментарии ребром не становится', () => {
    expect(edgeSet([
      { rel: 'a.php', content: '<?php\n// $x = new Legacy();\n/**\n * new Widget()\n */' },
      { rel: 'Legacy.php', content: '<?php class Legacy {}' },
      { rel: 'Widget.php', content: '<?php class Widget {}' },
    ])).toEqual([])
  })

  it('две одинаково близкие копии класса — молчание; ближайшая по дереву — побеждает', () => {
    expect(edgeSet([
      { rel: 'x/app.php', content: '<?php $d = new Dup();' },
      { rel: 'a/Dup.php', content: '<?php class Dup {}' },
      { rel: 'b/Dup.php', content: '<?php class Dup {}' },
    ])).toEqual([])
    expect(edgeSet([
      { rel: 'a/app.php', content: '<?php $d = new Dup();' },
      { rel: 'a/Dup.php', content: '<?php class Dup {}' },
      { rel: 'b/Dup.php', content: '<?php class Dup {}' },
    ])).toEqual(['a/app.php→a/Dup.php'])
  })

  it('js-семейство ссылками по имени не связывается — там импорты обязательны', () => {
    expect(edgeSet([
      { rel: 'src/a.ts', content: 'class A extends B {}\nB.method()' },
      { rel: 'src/B.ts', content: 'export class B {}' },
    ])).toEqual([])
  })
})

describe('ruby: константная автозагрузка (Rails/Zeitwerk) — рёбра без require', () => {
  it('наследование, include, константа-получатель и путь A::B', () => {
    const e = edgeSet([
      { rel: 'app/models/user.rb', content: 'class User < ApplicationRecord\n  include Trackable\nend' },
      { rel: 'app/models/application_record.rb', content: 'class ApplicationRecord\nend' },
      { rel: 'app/models/concerns/trackable.rb', content: 'module Trackable\nend' },
      {
        rel: 'app/services/billing.rb',
        content: 'class Billing\n  def run\n    JSON.parse("{}")\n    User.find(1)\n    Payments::Gateway.new.charge\n  end\nend',
      },
      { rel: 'lib/payments/gateway.rb', content: 'module Payments\n  class Gateway\n  end\nend' },
    ])
    // JSON проектом не объявлен — ребра нет
    expect(e).toEqual([
      'app/models/user.rb→app/models/application_record.rb',
      'app/models/user.rb→app/models/concerns/trackable.rb',
      'app/services/billing.rb→app/models/user.rb',
      'app/services/billing.rb→lib/payments/gateway.rb',
    ].sort())
  })
})

describe('обход: производные зоны — имена каталогов и объявления самого проекта', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-walk-skips-'))
  const put = (rel: string, content: string): void => {
    const abs = join(proj, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  put('src/own.php', '<?php class Own {}')
  put('protected/vendors/aws/Sdk.php', '<?php class Sdk {}')
  put('third_party/lib.js', 'export const x = 1')
  put('generated/x.php', '<?php')
  put('app/generated/inside.php', '<?php')
  put('secretstuff/y.php', '<?php')
  put('deep/secretstuff/z.php', '<?php')
  put('logs/app.php', '<?php')
  put('.gitignore', '# коммент\n/generated\nsecretstuff\n*.log\n!keep\n')

  it('vendors и third_party пропускаются по имени, .gitignore — по объявлению', () => {
    const rels = walkFiles(proj).map((f) => relative(proj, f.path).replaceAll('\\', '/'))
    expect(rels).toContain('src/own.php')
    expect(rels).toContain('logs/app.php')
    // Якорь корня соблюдается: /generated не накрывает app/generated
    expect(rels).toContain('app/generated/inside.php')
    expect(rels.some((r) => r.includes('vendors/'))).toBe(false)
    expect(rels.some((r) => r.startsWith('third_party/'))).toBe(false)
    expect(rels.some((r) => r.startsWith('generated/'))).toBe(false)
    // Имя без «/» действует на любой глубине — как в git
    expect(rels.some((r) => r.includes('secretstuff'))).toBe(false)
  })

  it('inDerivedZone знает новые написания', () => {
    expect(inDerivedZone('protected/vendors/aws/Sdk.php')).toBe(true)
    expect(inDerivedZone('third_party/lib.js')).toBe(true)
    expect(inDerivedZone('src/own.php')).toBe(false)
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
