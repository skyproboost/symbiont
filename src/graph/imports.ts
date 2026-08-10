/**
 * Извлечение и резолв импортов (файловый уровень) — для любого языка проекта.
 *
 * Языковые пакеты здесь — ДАННЫЕ: язык добавляется строкой таблицы (как
 * детекторы стека и языковые пакеты майнера). Долго в таблице жило только
 * JS-семейство плюс Python и PHP-require: на Go-, Java-, C#- и Rust-проекте
 * граф импортов молча выходил пустым — ни ключевых модулей, ни радиуса влияния,
 * ни связанных по задаче. Статистика слоя 0 при этом работала, и разрыв между
 * «работает на любом языке» и «граф есть только у JS» был снаружи незаметен.
 *
 * ГЛАВНАЯ ТРУДНОСТЬ НЕ В ИЗВЛЕЧЕНИИ, А В РЕЗОЛВЕ. Достать `use A\B\C` или
 * `import "mod/pkg"` из текста умеет и регэксп, и грамматика; вопрос всегда в
 * другом — КАКОМУ файлу проекта соответствует это имя. Отсюда два механизма,
 * и оба опираются на данные самого проекта, а не на знание про менеджер пакетов:
 *
 *   1) РЕЗОЛВ ПО ОБЪЯВЛЕННОМУ (форма decl). Файлы сами объявляют, в каком они
 *      пространстве имён (`package a.b;`, `namespace A\B;`). Индекс объявлений
 *      превращает `import a.b.C` в файл точно, а не по совпадению имени:
 *      `java.util.List` не объявлен в проекте — ребра нет. Так закрываются
 *      PSR-4 у PHP и пакеты у Java/Kotlin/Scala/C# без чтения composer.json.
 *   2) СУФФИКСНЫЙ РЕЗОЛВ С ТРЕБОВАНИЕМ ЕДИНСТВЕННОСТИ (формы path/symbol).
 *      Спецификатор — хвост пути: `@/../config/languages`, `wp-includes/load.php`,
 *      `github.com/u/repo/internal/db`. Ищем файлы, чей путь заканчивается этим
 *      хвостом; ребро ставится, только если кандидат один. При нескольких копиях
 *      (два бандла AWS SDK в одном WordPress) выигрывает ближайшая по дереву —
 *      ровно так и работает автозагрузка внутри пакета; при равенстве — молчим.
 *   3) ССЫЛКИ ПО ИМЕНИ ТИПА (форма name) — для стеков, где импортов почти нет.
 *      Yii 1.x, WordPress-классика, Rails: код связывает автозагрузка по имени
 *      класса, а не import (боевой замер: из 1227 файлов Yii-проекта require
 *      был в 3, use — в 32; граф выходил точками без рёбер). Ребро дают
 *      `extends`/`new X`/`X::`/тайп-хинты/строковый литерал-класс, а резолв —
 *      индекс типов, ОБЪЯВЛЕННЫХ файлами проекта (typeDecl), с семантикой
 *      пространств самого языка: голое имя в namespace-файле живёт в этом
 *      пространстве, голая строка класса разрешается только в глобальное — как
 *      и делает автозагрузчик. JVM/C#-ссылки внутри пакета сознательно не
 *      извлекаются: там import обязателен для всего внепакетного, граф уже есть,
 *      а внутрипакетные рёбра лишь уплотнили бы его ценой нового шума.
 *
 * Инвариант прежний: догадка в графе хуже отсутствия ребра, потому что врёт про
 * структуру проекта. Неоднозначность = нет ребра, всегда.
 *
 * ОТВЕРГНУТО: доставать импорты из AST слоя 1 (16 грамматик уже едут с плагином).
 * Грамматика дала бы более точное ИЗВЛЕЧЕНИЕ, но ничего не дала бы РЕЗОЛВУ —
 * узкому месту, — зато потянула бы за собой асинхронность WASM через весь
 * синхронный путь сборки паспорта (buildEdges ← salsa ← хук). Плата
 * несоразмерна выигрышу. Согласие двух путей не оставлено на веру: тест
 * tests/imports-ast.test.ts парсит те же файлы грамматиками слоя 1 и требует,
 * чтобы множество импортов совпало с регэкспным — грамматика работает
 * проверяющим, а не рантаймом.
 */
import { dirname, join, normalize } from 'node:path/posix'

/**
 * Форма спецификатора — она же способ резолва.
 * path — путь (относительный/от корня/через алиас); symbol — имя модуля через
 * разделители (Go, Python, Rust, Lua); decl — имя в пространстве имён, которое
 * ищется среди объявленных в проекте; name — ссылка по имени типа (extends,
 * new X, X::, класс строкой), ищется среди типов, объявленных в проекте.
 */
export type SpecForm = 'path' | 'symbol' | 'decl' | 'name'

interface SpecPattern {
  re: RegExp
  form: SpecForm
  /** одно совпадение → несколько спецификаторов (группы импорта, `from . import a, b`) */
  expand?: (m: RegExpMatchArray) => string[]
  /** форма живёт В комментарии (заголовок-ссылка) или в директиве препроцессора */
  inComment?: boolean
  /** имя всегда полное (строковый литерал класса) — пространством файла не достраивается */
  bare?: boolean
}

interface LangPack {
  id: string
  exts: string[]
  patterns: SpecPattern[]
  /** чем достраивается путь без расширения */
  targets: string[]
  /** файл-индекс каталога: импорт каталога = импорт этого файла */
  indexes: string[]
  /** разделители сегментов символьного/декларативного имени */
  sep: RegExp
  /** объявление пространства имён — источник индекса для формы decl */
  nsDecl: RegExp | null
  /** объявление типа (класс/интерфейс/трейт) — источник индекса для формы name */
  typeDecl: RegExp | null
  /** ссылки на типы по имени — рёбра стеков, где импортов почти нет (автозагрузка) */
  refPatterns: SpecPattern[]
  /** спецификатор указывает на КАТАЛОГ-пакет (Go): рёбра ко всем файлам каталога */
  packageDir: boolean
  /** допустимо отбрасывать ведущие сегменты (корень алиаса/автозагрузки неизвестен) */
  leadingDrop: boolean
  /** допустимо отбрасывать хвостовые сегменты (имя типа внутри модуля — Rust) */
  trailingDrop: boolean
}

const defaults = {
  targets: [] as string[],
  indexes: [] as string[],
  sep: /[./\\]/,
  nsDecl: null,
  typeDecl: null,
  refPatterns: [] as SpecPattern[],
  packageDir: false,
  leadingDrop: false,
  trailingDrop: false,
}

const pack = (p: Pick<LangPack, 'id' | 'exts' | 'patterns'> & Partial<LangPack>): LangPack => ({ ...defaults, ...p })

/** Список имён после `import`/`use` — общая форма для групповых импортов. */
const names = (list: string): string[] =>
  list
    .split(',')
    .map((s) => s.trim().split(/\s+as\s+/i)[0].trim())
    .filter((s) => /^[\w$]/.test(s))

const JS_TARGETS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue']

/**
 * Таблица языков. Новый язык — новая строка; логика резолва общая для всех.
 * Swift сознательно отсутствует: `import Foo` называет МОДУЛЬ сборки, а не файл,
 * и связь «модуль → файл» без чтения манифеста Package.swift была бы догадкой.
 */
const PACKS: LangPack[] = [
  pack({
    id: 'js',
    exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue'],
    patterns: [
      { re: /import\s+[^'"()]*?from\s+['"]([^'"]+)['"]/g, form: 'path' },
      { re: /export\s+[^'"()]*?from\s+['"]([^'"]+)['"]/g, form: 'path' },
      { re: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, form: 'path' },
      { re: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, form: 'path' },
      { re: /import\s+['"]([^'"]+)['"]/g, form: 'path' },
      // Формы до ES-модулей — они и сегодня держат легаси-фронтенд: AMD-список
      // зависимостей и заголовок-ссылка. На боевом проекте (Marionette/jQuery,
      // 208 файлов) это была ЕДИНСТВЕННАЯ форма связи, и граф выходил пустым
      {
        re: /\b(?:define|require)\s*\(\s*\[([^\]]*)\]/g,
        form: 'path',
        expand: (m) => [...m[1].matchAll(/['"]([^'"\n]+)['"]/g)].map((x) => x[1]),
      },
      { re: /\/\/\/?\s*<reference\s+path\s*=\s*['"]([^'"]+)['"]/g, form: 'path', inComment: true },
    ],
    targets: JS_TARGETS,
    indexes: JS_TARGETS.map((e) => `index${e}`),
    leadingDrop: true,
  }),
  pack({
    id: 'py',
    exts: ['.py', '.pyi'],
    patterns: [
      // `from . import util, models` — модуль назван не слева, а справа от import
      {
        re: /^[ \t]*from\s+(\.+)\s+import\s+([^\n#]+)/gm,
        form: 'symbol',
        expand: (m) => names(m[2]).map((n) => m[1] + n),
      },
      { re: /^[ \t]*from\s+([.\w]+)\s+import\s/gm, form: 'symbol' },
      { re: /^[ \t]*import\s+([.\w]+)/gm, form: 'symbol' },
    ],
    targets: ['.py', '.pyi'],
    indexes: ['__init__.py'],
    sep: /\./,
    leadingDrop: true,
  }),
  pack({
    id: 'php',
    exts: ['.php', '.phtml', '.inc'],
    patterns: [
      // Путь берётся последним строковым литералом выражения: `ABSPATH . 'wp-includes/load.php'`,
      // `dirname(__FILE__) . '/x.php'` — префикс задаётся константой, а хвост всегда литерал
      { re: /\b(?:require|include)(?:_once)?\s*\(?[^;\n]*['"]([^'"\n]+)['"]/g, form: 'path' },
      // `use A\B\{C, D};` — групповая форма
      {
        re: /^[ \t]*use\s+([\w\\]+)\\\{([^}]+)\}/gm,
        form: 'decl',
        expand: (m) => names(m[2]).map((n) => `${m[1]}\\${n}`),
      },
      { re: /^[ \t]*use\s+(?:function\s+|const\s+)?([\w\\]+)/gm, form: 'decl' },
    ],
    targets: ['.php', '.phtml', '.inc'],
    sep: /[\\/]/,
    // `<?php class X {}` в одну строку — легитимная форма короткого файла,
    // поэтому якорь строки допускает открывающий тег перед объявлением
    nsDecl: /^[ \t]*(?:<\?php\s+)?namespace\s+([\w\\]+)/m,
    typeDecl: /^[ \t]*(?:<\?php\s+)?(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+(\w+)/gm,
    // Легаси-PHP (Yii 1.x, WordPress-классика) связан автозагрузкой по имени
    // класса, а не импортами: require был в 3 файлах из 1227, use — в 32.
    // Ссылка на тип — единственная форма связи; шум режет резолв (имя обязано
    // быть ОБЪЯВЛЕНО проектом), а не извлечение
    refPatterns: [
      // `class A extends B implements C, D` — у интерфейсов extends тоже список
      { re: /\bextends\s+(\\?\w+(?:\\\w+)*(?:\s*,\s*\\?\w+(?:\\\w+)*)*)/g, form: 'name', expand: (m) => m[1].split(',') },
      { re: /\bimplements\s+(\\?\w+(?:\\\w+)*(?:\s*,\s*\\?\w+(?:\\\w+)*)*)/g, form: 'name', expand: (m) => m[1].split(',') },
      { re: /\bnew\s+(\\?[A-Za-z_][\w\\]*)/g, form: 'name' },
      // Статический доступ `X::` — лукбихайнд отсекает `$var::` и хвосты
      // квалифицированных имён (сегмент после `\` — не начало ссылки)
      { re: /(?<![\w$>\\])(\\?[A-Za-z_][\w\\]*)\s*::/g, form: 'name' },
      { re: /\binstanceof\s+(\\?[A-Za-z_][\w\\]*)/g, form: 'name' },
      { re: /\bcatch\s*\(\s*(\\?[\w\\]+(?:\s*\|\s*\\?[\w\\]+)*)/g, form: 'name', expand: (m) => m[1].split('|') },
      // Тайп-хинты: параметр `(?User $u` и возврат `): ?User` — рёбра DI-стиля
      { re: /[(,]\s*\??(\\?[A-Za-z_][\w\\]*)\s+\$\w/g, form: 'name' },
      { re: /\)\s*:\s*\??(\\?[A-Za-z_][\w\\]*)/g, form: 'name' },
      // Класс строковым литералом: конфиги компонентов (`'class' => 'Api'`),
      // фабрики, AR-relations Yii (`self::BELONGS_TO, 'UserAro'`). bare: строка —
      // всегда полное имя, и голая разрешается только в глобальный тип (так
      // работает автозагрузчик), поэтому надпись 'Active' не поймает App\Active
      { re: /['"](\\?[A-Za-z_]\w*(?:\\+[A-Za-z_]\w*)*)['"]/g, form: 'name', bare: true },
      // Точечный алиас пути (Yii): 'application.components.Foo' — класс это последний сегмент
      { re: /['"](?:[a-z]\w*\.)+([A-Z]\w*)['"]/g, form: 'name', bare: true },
    ],
    leadingDrop: true,
  }),
  pack({
    id: 'go',
    exts: ['.go'],
    patterns: [
      {
        re: /\bimport\s*\(([\s\S]*?)\)/g,
        form: 'symbol',
        expand: (m) => [...m[1].matchAll(/"([^"\n]+)"/g)].map((x) => x[1]),
      },
      { re: /\bimport\s+(?:[\w.]+\s+)?"([^"\n]+)"/g, form: 'symbol' },
    ],
    targets: ['.go'],
    sep: /\//,
    packageDir: true,
    leadingDrop: true,
  }),
  pack({
    id: 'jvm',
    exts: ['.java', '.kt', '.kts', '.scala', '.groovy'],
    patterns: [{ re: /^[ \t]*import\s+(?:static\s+)?([\w.*]+)/gm, form: 'decl' }],
    targets: ['.java', '.kt', '.kts', '.scala', '.groovy'],
    sep: /\./,
    nsDecl: /^[ \t]*package\s+([\w.]+)/m,
  }),
  pack({
    id: 'cs',
    exts: ['.cs'],
    // `using X;` — зависимость от ПРОСТРАНСТВА целиком (файловых импортов в C# нет);
    // `using var x = …` и `using (…)` отсекаются требованием точки с запятой сразу
    // за именем, `using X = A.B` — алиас, разрешается по правой части
    patterns: [
      { re: /^[ \t]*using\s+(?:static\s+)?([\w.]+)\s*;/gm, form: 'decl' },
      { re: /^[ \t]*using\s+[\w]+\s*=\s*([\w.]+)\s*;/gm, form: 'decl' },
    ],
    targets: ['.cs'],
    sep: /\./,
    nsDecl: /^[ \t]*namespace\s+([\w.]+)/m,
  }),
  pack({
    id: 'rust',
    exts: ['.rs'],
    patterns: [
      { re: /^[ \t]*(?:pub\s+)?mod\s+([\w]+)\s*;/gm, form: 'symbol', expand: (m) => [`self::${m[1]}`] },
      { re: /^[ \t]*(?:pub\s+)?use\s+([\w:]+)/gm, form: 'symbol' },
    ],
    targets: ['.rs'],
    indexes: ['mod.rs'],
    sep: /::/,
    leadingDrop: true,
    trailingDrop: true,
  }),
  pack({
    id: 'ruby',
    exts: ['.rb', '.rake'],
    patterns: [
      // require_relative считается ОТ ФАЙЛА, даже когда записан без «./» —
      // приводим к явной относительной форме, иначе имя без расширения выглядит
      // как внешний гем и отбрасывается
      {
        re: /\brequire_relative\s*\(?\s*['"]([^'"\n]+)['"]/g,
        form: 'path',
        expand: (m) => [/^\.{1,2}\//.test(m[1]) ? m[1] : `./${m[1]}`],
      },
      { re: /\brequire\s*\(?\s*['"]([^'"\n]+)['"]/g, form: 'path' },
    ],
    targets: ['.rb', '.rake'],
    // Rails/Zeitwerk — тот же пробел, что у легаси-PHP: код app/ не пишет
    // require вовсе, связывает автозагрузка констант. Инфлексия ИМЕНИ В ПУТЬ
    // (`UsersController` → users_controller.rb) отвергнута — это догадка о
    // конфигурации загрузчика; индекс объявленных типов — знание самого проекта
    sep: /::|[./\\]/,
    typeDecl: /^[ \t]*(?:class|module)\s+(?:\w+::)*([A-Z]\w*)/gm,
    refPatterns: [
      { re: /^[ \t]*class\s+(?:\w+::)*\w+\s*<\s*((?:\w+::)*[A-Z]\w*)/gm, form: 'name' },
      { re: /\b(?:include|extend|prepend)\s+((?:\w+::)*[A-Z]\w*)/g, form: 'name' },
      { re: /\b([A-Z]\w*(?:::[A-Z]\w*)+)/g, form: 'name' },
      // Константа-получатель: `User.find`, `Gateway.new` — самая частая форма ссылки
      { re: /\b([A-Z]\w*)(?=\.[a-z_])/g, form: 'name' },
    ],
    leadingDrop: true,
  }),
  pack({
    id: 'c',
    exts: ['.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cxx'],
    // Только кавычки: `<stdio.h>` — системный заголовок, файлом проекта не бывает
    patterns: [{ re: /^[ \t]*#\s*include\s+"([^"\n]+)"/gm, form: 'path', inComment: true }],
    targets: ['.h', '.hpp', '.hh', '.c', '.cpp', '.cc', '.cxx'],
    leadingDrop: true,
  }),
  pack({
    id: 'dart',
    exts: ['.dart'],
    patterns: [{ re: /^[ \t]*(?:import|part|export)\s+['"]([^'"\n]+)['"]/gm, form: 'path' }],
    targets: ['.dart'],
    leadingDrop: true,
  }),
  pack({
    id: 'lua',
    exts: ['.lua'],
    patterns: [{ re: /\brequire\s*\(?\s*['"]([^'"\n]+)['"]/g, form: 'symbol' }],
    targets: ['.lua'],
    indexes: ['init.lua'],
    sep: /[./]/,
    leadingDrop: true,
  }),
]

const BY_EXT = new Map<string, LangPack>()
for (const p of PACKS) for (const e of p.exts) BY_EXT.set(e, p)

/** Расширения, у которых импорты разбираются (единый источник для проверок). */
export const importExts = (): string[] => [...BY_EXT.keys()]

/**
 * Языки, для которых импорты не разбираются СОЗНАТЕЛЬНО — с причиной.
 * Список нужен не для документации, а для само-линта: он сверяет расширения
 * кода и грамматик слоя 1 с этой таблицей, и молчаливое «язык есть, а графа у
 * него нет» падает красным. Забытый язык и отвергнутый должны различаться.
 */
export const NO_IMPORT_LANGS: Record<string, string> = {
  '.swift': 'import называет модуль сборки, а не файл; связь «модуль → файл» без Package.swift была бы догадкой',
  '.pl': 'use/require указывают на модуль в @INC — путь зависит от конфигурации запуска, а не от дерева проекта',
  '.r': 'source() принимает произвольное выражение пути, строковый литерал в нём скорее исключение',
}

const extOf = (rel: string): string => {
  const dot = rel.lastIndexOf('.')
  const slash = rel.lastIndexOf('/')
  return dot === -1 || dot < slash ? '' : rel.slice(dot).toLowerCase()
}

const packOf = (rel: string): LangPack | null => BY_EXT.get(extOf(rel)) ?? null

export interface ImportSpec {
  spec: string
  form: SpecForm
}

/**
 * Строка совпадения начинается с маркера комментария. Закомментированный
 * импорт — не зависимость, а документация про зависимость: на боевом WordPress
 * фраза «Likely values include 'plugin'» в phpdoc давала настоящее ребро графа.
 * Директивы препроцессора и заголовки-ссылки помечены inComment и не отсекаются.
 */
const COMMENTED = /(?:^|\n)[ \t]*(?:\/\/|\/\*|\*|#|--)[^\n]*$/

/**
 * Слова языка, которые шаблоны ссылок ловят наравне с именами типов (`new
 * static`, `(array $x`, `parent::`): резолв их и так отбросил бы (проект таких
 * типов не объявляет), но стоп-лист снимает заведомо пустую работу с самых
 * частых совпадений. Регистронезависим — PHP-ключевые слова пишут по-разному.
 */
const REF_STOP = new Set([
  'self', 'parent', 'static', 'class', 'function', 'fn', 'new', 'clone', 'return',
  'string', 'int', 'float', 'bool', 'array', 'object', 'mixed', 'void', 'never',
  'null', 'true', 'false', 'callable', 'iterable', 'this', 'match', 'list',
  'if', 'else', 'elseif', 'for', 'foreach', 'while', 'switch', 'case', 'default',
  'throw', 'try', 'catch', 'finally', 'global', 'echo', 'print', 'use', 'const',
  'abstract', 'final', 'readonly', 'public', 'private', 'protected', 'var',
  'extends', 'implements', 'interface', 'trait', 'enum', 'instanceof', 'insteadof',
  'namespace', 'require', 'include', 'require_once', 'include_once', 'and', 'or', 'xor', 'yield',
])

/** Спецификаторы файла вместе с формой — вход резолва. */
export function extractSpecs(content: string, rel: string): ImportSpec[] {
  const p = packOf(rel)
  if (!p) return []
  const seen = new Set<string>()
  const out: ImportSpec[] = []
  const add = (form: SpecForm, spec: string): void => {
    // Разделитель — перевод строки: ни форма, ни спецификатор его не
    // содержат (все шаблоны запрещают перенос внутри имени). Сырой NUL в
    // исходнике был бы хуже — он делает файл «бинарным» для grep, и модуль
    // молча выпадает из поиска по коду (грабля из истории проекта)
    const key = `${form}\n${spec}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ spec, form })
  }
  const commented = (sp: SpecPattern, m: RegExpMatchArray): boolean =>
    !sp.inComment && m.index !== undefined && COMMENTED.test(content.slice(Math.max(0, content.lastIndexOf('\n', m.index)), m.index + 1))
  for (const sp of p.patterns) {
    for (const m of content.matchAll(sp.re)) {
      if (commented(sp, m)) continue
      for (const spec of sp.expand ? sp.expand(m) : [m[1]]) {
        if (spec) add(sp.form, spec)
      }
    }
  }
  if (p.refPatterns.length > 0) {
    // Пространство файла определяет, ЧТО значит голое имя: `new X` при
    // `namespace A\B` — это A\B\X и только оно (PHP не ищет в глобальном),
    // поэтому квалификация происходит при извлечении, пока пространство под рукой
    const ns = p.nsDecl ? (content.match(p.nsDecl)?.[1] ?? null) : null
    for (const sp of p.refPatterns) {
      for (const m of content.matchAll(sp.re)) {
        if (commented(sp, m)) continue
        for (const raw of sp.expand ? sp.expand(m) : [m[1]]) {
          const name = (raw ?? '').trim()
          if (!name) continue
          const rooted = name.startsWith('\\')
          const body = rooted ? name.replace(/^\\+/, '') : name
          if (!body || REF_STOP.has(body.toLowerCase())) continue
          // Строковые литералы (bare) и корневые `\X` — уже полные имена;
          // голое имя кода в файле с пространством — имя ВНУТРИ пространства
          const spec = !rooted && !sp.bare && ns !== null && !body.includes('\\') ? `${ns}\\${body}` : body
          add('name', spec)
        }
      }
    }
  }
  return out
}

/**
 * Спецификаторы импортов файла. rel — чтобы выбрать языковой пакет; без него
 * действует JS-набор (обратная совместимость вызовов и тестов).
 */
export function extractImports(content: string, rel = 'x.ts'): string[] {
  return [...new Set(extractSpecs(content, rel).map((s) => s.spec))]
}

/**
 * Индекс проекта для резолва. Строится один раз на сборку графа: без него
 * суффиксный поиск был бы перебором всех файлов на каждый спецификатор
 * (на WordPress это 2.5 тысячи файлов × тысячи импортов).
 */
/** Файл индекса: путь и он же без расширения — сравнение хвоста идёт по второму. */
interface IndexedFile {
  path: string
  noExt: string
  ext: string
}

/** Объявленный тип: где объявлен и в каком пространстве (null — глобальный или язык без пространств). */
interface DeclaredType {
  path: string
  ns: string | null
}

export interface ImportIndex {
  files: Set<string>
  /** имя файла без расширения → файлы */
  byBase: Map<string, IndexedFile[]>
  /** имя последнего сегмента каталога → каталоги */
  byDirName: Map<string, string[]>
  /** каталог → файлы каталога */
  dirFiles: Map<string, string[]>
  /** пространство имён (сегменты через точку) → объявившие файлы */
  byNs: Map<string, string[]>
  /** имя объявленного типа → объявления; источник резолва формы name */
  byType: Map<string, DeclaredType[]>
  /** каталоги верхнего уровня — признак спецификатора «от корня проекта» */
  rootDirs: Set<string>
  total: number
  /**
   * Память резолва: ключ — каталог импортёра, форма и спецификатор. Больше
   * резолв ни от чего не зависит (относительные пути считаются от каталога,
   * близость — тоже), поэтому попадание в память ТОЧНОЕ, а не приблизительное.
   * Соседи по каталогу импортируют одно и то же постоянно: на репозитории в 14
   * тысяч файлов это разница между 11 и 1 секундой.
   */
  memo: Map<string, string[]>
  /**
   * Память суффиксного поиска: хвост → файлы, чьи пути им заканчиваются. От
   * импортёра НЕ зависит вовсе (зависит только выбор среди найденных), поэтому
   * попадание точное. Тысяча каталогов, импортирующих один и тот же модуль, —
   * обычное дело в репозитории с вендоренными зависимостями: там на этой памяти
   * держится разница между секундами и десятками миллисекунд.
   */
  tailMemo: Map<string, string[]>
}

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

const baseOf = (rel: string): string => {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

/** Нормализация пространства имён к точкам: `A\B` и `A.B` — одно и то же. */
const nsKey = (s: string): string => s.replace(/[\\/]+/g, '.').replace(/^\.+|\.+$/g, '')

/**
 * Индекс из файлов проекта. content нужен только для объявлений пространств
 * имён; без него (вызов по одному списку путей) работают формы path и symbol.
 */
export function buildImportIndex(files: Array<{ rel: string; content?: string }>): ImportIndex {
  const index: ImportIndex = {
    files: new Set(files.map((f) => f.rel)),
    byBase: new Map(),
    byDirName: new Map(),
    dirFiles: new Map(),
    byNs: new Map(),
    byType: new Map(),
    rootDirs: new Set(),
    total: files.length,
    memo: new Map(),
    tailMemo: new Map(),
  }
  const dirs = new Set<string>()
  for (const f of files) {
    const ext = extOf(f.rel)
    push(index.byBase, baseOf(f.rel), { path: f.rel, noExt: ext ? f.rel.slice(0, -ext.length) : f.rel, ext })
    const slash = f.rel.lastIndexOf('/')
    const dir = slash === -1 ? '' : f.rel.slice(0, slash)
    push(index.dirFiles, dir, f.rel)
    if (dir) {
      dirs.add(dir)
      index.rootDirs.add(dir.split('/')[0])
    }
    const p = packOf(f.rel)
    if (p && f.content) {
      const ns = p.nsDecl ? (f.content.match(p.nsDecl)?.[1] ?? null) : null
      if (ns !== null) push(index.byNs, nsKey(ns), f.rel)
      if (p.typeDecl) {
        for (const m of f.content.matchAll(p.typeDecl)) push(index.byType, m[1], { path: f.rel, ns })
      }
    }
  }
  for (const d of dirs) push(index.byDirName, d.slice(d.lastIndexOf('/') + 1), d)
  return index
}

/**
 * Ближайший кандидат по дереву каталогов: расстояние = сколько шагов вверх и
 * вниз от импортёра до кандидата. Так две копии одной библиотеки в разных
 * плагинах WordPress не путаются между собой. Равенство — отказ: ребро по
 * жребию было бы той самой догадкой, которой здесь не место.
 *
 * Первая версия считала длину общего префикса — и на боевом WordPress признала
 * равными соседа по каталогу и файл этажом ниже (общий префикс у них один и тот
 * же), из-за чего ТЕРЯЛА верное ребро `require __DIR__ . '/functions.php'`.
 * Расстояние учитывает и спуск, поэтому сосед всегда ближе вложенного.
 */
/** Каталог пути посегментно — с памятью: один и тот же файл сравнивается многократно. */
const DIR_SEGS = new Map<string, string[]>()
const dirSegs = (path: string): string[] => {
  const cached = DIR_SEGS.get(path)
  if (cached) return cached
  const segs = path.split('/').slice(0, -1)
  // Память общая на процесс: пути коротки, а число файлов ограничено обходом
  if (DIR_SEGS.size < 100_000) DIR_SEGS.set(path, segs)
  return segs
}

function nearest(fromRel: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const a = dirSegs(fromRel)
  let best: string | null = null
  let bestDist = Infinity
  let tie = false
  for (const c of candidates) {
    const b = dirSegs(c)
    let s = 0
    while (s < a.length && s < b.length && a[s] === b[s]) s++
    const dist = a.length - s + (b.length - s)
    if (dist < bestDist) {
      bestDist = dist
      best = c
      tie = false
    } else if (dist === bestDist) tie = true
  }
  return tie ? null : best
}

/**
 * Потолок числа файлов с ОДНИМ базовым именем, после которого суффиксный поиск
 * не начинается. Смысл не только в цене: когда одно имя носят сотни файлов
 * (вендоренный интерпретатор, монорепозиторий фреймворка), «единственный или
 * ближайший» вырождается в жребий, и правильный ответ — молчание. Цена при этом
 * тоже реальна: на репозитории с вложенным дистрибутивом Python таких имён
 * тысячи, и полный перебор стоил секунд внутри хук-бюджета.
 */
const MAX_SAME_NAME = 64

/**
 * Базовые имена файлов-индексов пакета: у JS девять записей `index.*` дают одно
 * имя `index`, и перебирать список файлов девять раз незачем.
 */
const INDEX_BASES = new Map<string, string[]>()
const indexBases = (p: LangPack): string[] => {
  const cached = INDEX_BASES.get(p.id)
  if (cached) return cached
  const bases = [...new Set(p.indexes.map(baseOf))]
  INDEX_BASES.set(p.id, bases)
  return bases
}

/**
 * Файлы, чей путь заканчивается хвостом tail (+ расширение или файл-индекс).
 * Кандидаты перебираются ОДИН раз, а не по разу на каждое целевое расширение:
 * у JS их девять, а список файлов с базовым именем `index` на большом
 * репозитории — тысячи. Именно это умножение и стоило секунд.
 */
function matchTail(tail: string, p: LangPack, index: ImportIndex): string[] {
  if (!tail) return []
  const memoKey = `${p.id}\n${tail}`
  const cached = index.tailMemo.get(memoKey)
  if (cached) return cached
  const found = matchTailUncached(tail, p, index)
  index.tailMemo.set(memoKey, found)
  return found
}

function matchTailUncached(tail: string, p: LangPack, index: ImportIndex): string[] {
  const out = new Set<string>()
  const last = tail.slice(tail.lastIndexOf('/') + 1)
  if ((index.byBase.get(last)?.length ?? 0) > MAX_SAME_NAME) return []
  const dot = last.lastIndexOf('.')
  const hasExt = dot > 0 && /^[A-Za-z0-9]+$/.test(last.slice(dot + 1))
  // Спецификатор С расширением сравнивается с полным путём, без — с путём без
  // расширения, а само расширение проверяется по списку целевых
  for (const c of index.byBase.get(hasExt ? last.slice(0, dot) : last) ?? []) {
    if (!hasExt && !p.targets.includes(c.ext)) continue
    const side = hasExt ? c.path : c.noExt
    if (side === tail || side.endsWith(`/${tail}`)) out.add(c.path)
  }
  for (const base of indexBases(p)) {
    const want = `${tail}/${base}`
    for (const c of index.byBase.get(base) ?? []) {
      if (!p.targets.includes(c.ext)) continue
      if (c.noExt === want || c.noExt.endsWith(`/${want}`)) out.add(c.path)
    }
  }
  return [...out]
}

/** Файлы каталога-пакета, чей путь заканчивается хвостом tail (Go). */
function matchPackageDir(tail: string, p: LangPack, index: ImportIndex): string[][] {
  const last = tail.slice(tail.lastIndexOf('/') + 1)
  const groups: string[][] = []
  for (const dir of index.byDirName.get(last) ?? []) {
    if (dir !== tail && !dir.endsWith(`/${tail}`)) continue
    const inside = (index.dirFiles.get(dir) ?? []).filter((f) => p.targets.includes(extOf(f)))
    if (inside.length > 0) groups.push(inside)
  }
  return groups
}

/**
 * Хвосты спецификатора от самого специфичного к менее специфичному.
 * Ведущие сегменты отбрасываются там, где корень неизвестен (алиас сборщика,
 * корень автозагрузки, префикс go-модуля); хвостовые — только в Rust, где
 * последние сегменты пути называют тип внутри модуля, а не файл.
 */
function tails(segs: string[], p: LangPack): string[] {
  const out: string[] = []
  const maxLead = p.leadingDrop ? segs.length - 1 : 0
  const maxTrail = p.trailingDrop ? Math.min(2, segs.length - 1) : 0
  for (let len = segs.length; len >= 1; len--) {
    for (let start = 0; start <= maxLead; start++) {
      const end = start + len
      if (end > segs.length) continue
      if (segs.length - end > maxTrail) continue
      out.push(segs.slice(start, end).join('/'))
    }
  }
  return [...new Set(out)]
}

const SIGIL = /^(?:~~\/|~\/|@\/|#\/|\$\/)/

/**
 * Односегментное имя без корня — почти всегда чужая библиотека, а не файл
 * проекта: `import subprocess`, `import "fmt"`, `require 'json'`. Совпадение по
 * одному имени тогда чистая случайность, и оно случается: на боевом проекте с
 * вендоренным окружением `import subprocess` уводило в `pip/_internal/utils/
 * subprocess.py`. Одного сегмента достаточно, только если корень назван явно —
 * сигилом сборщика, расширением файла или `crate::`.
 */
const bareAllowed = (segs: string[], rooted: boolean): boolean => segs.length >= 2 || rooted

/** Резолв формы path: относительные — точно, алиасные и корневые — по суффиксу. */
function resolvePath(fromRel: string, spec: string, p: LangPack, index: ImportIndex): string[] {
  const clean = spec.replace(/^package:/, '').replace(/[?#].*$/, '')
  if (clean.startsWith('./') || clean.startsWith('../')) {
    // Относительный путь однозначен: не нашли — значит связи нет. Суффиксный
    // добор здесь означал бы «промахнулись мимо файла, возьмём похожий»
    const base = normalize(join(dirname(fromRel), clean))
    if (base.startsWith('..')) return []
    const hit = matchTail(base, p, index).filter((f) => f === base || f.startsWith(`${base}.`) || f.startsWith(`${base}/`))
    const exact = nearest(fromRel, hit)
    return exact ? [exact] : []
  }
  const sigil = SIGIL.test(clean)
  const rest = normalize(clean.replace(SIGIL, '')).replace(/^(?:\.\.\/)+/, '')
  if (!rest || rest === '.') return []
  // Спецификатор бывает и мусорным («/», «..», пустая строка из шаблонизатора):
  // на боевом WordPress именно такой уронил разбор. Пустой набор сегментов —
  // не ошибка, а отсутствие цели
  const segs = rest.split('/').filter((s) => s && s !== '.')
  if (segs.length === 0) return []
  // Спецификатор без сигила — это либо путь от корня проекта, либо пакет из
  // node_modules/gems/composer. Отличаем двумя признаками, и оба структурные:
  // корневой сегмент — реальный каталог проекта (форма baseUrl), либо имя несёт
  // расширение целевого языка, то есть называет ФАЙЛ, а не пакет (`require
  // 'lib.php'`). Без этого различения `import 'chalk'` цеплялся к случайному
  // chalk.ts проекта — ровно та догадка, которой здесь не место
  const named = p.targets.includes(extOf(segs[segs.length - 1]))
  if (!sigil && !named && !index.rootDirs.has(segs[0])) return []
  if (!bareAllowed(segs, sigil || named)) return []
  for (const tail of tails(segs, p)) {
    const hit = nearest(fromRel, matchTail(tail, p, index))
    if (hit) return [hit]
  }
  return []
}

/** Резолв формы symbol: имя модуля через разделители → хвост пути. */
function resolveSymbol(fromRel: string, spec: string, p: LangPack, index: ImportIndex): string[] {
  let rel = 0
  let body = spec
  if (p.id === 'py') {
    rel = body.length - body.replace(/^\.+/, '').length
    body = body.slice(rel)
  } else if (p.id === 'rust') {
    const m = body.match(/^(crate|self|super)::/)
    if (m) {
      rel = m[1] === 'super' ? 2 : m[1] === 'self' ? 1 : 0
      body = body.slice(m[0].length)
      if (m[1] === 'crate') {
        // crate:: — от корня ящика; корень неизвестен, поэтому суффиксный поиск.
        // Корень назван явно, значит одного сегмента здесь достаточно
        const segs = body.split(p.sep).filter(Boolean)
        for (const tail of tails(segs, p)) {
          const hit = nearest(fromRel, matchTail(tail, p, index))
          if (hit) return [hit]
        }
        return []
      }
    }
  }
  const segs = body.split(p.sep).filter(Boolean)
  if (segs.length === 0) return []

  if (rel > 0) {
    // Относительное имя: одна точка — свой каталог, каждая следующая на уровень выше
    const up = Array.from({ length: rel - 1 }, () => '..').join('/')
    const base = normalize(join(dirname(fromRel), up, segs.join('/')))
    if (base.startsWith('..')) return []
    const hit = matchTail(base, p, index).filter((f) => f === base || f.startsWith(`${base}.`) || f.startsWith(`${base}/`))
    const exact = nearest(fromRel, hit)
    return exact ? [exact] : []
  }

  if (p.packageDir) {
    // Импорт называет каталог-пакет: рёбра ко всем его файлам. Единственность
    // требуется от КАТАЛОГА — иначе непонятно, чей это пакет
    if (!bareAllowed(segs, false)) return [] // `import "fmt"` — стандартная библиотека
    for (const tail of tails(segs, p)) {
      const groups = matchPackageDir(tail, p, index)
      // Сам импортёр здесь НЕ отсеивается: результат кладётся в память резолва,
      // общую для каталога, и «без себя» он был бы неверен для соседа
      if (groups.length === 1) return groups[0]
      if (groups.length > 1) return []
    }
    return []
  }

  // Абсолютное имя питона разрешается по sys.path, а он зависит от того, КАК
  // запускают: пакет от корня проекта либо скрипт из своего каталога. Обе
  // раскладки распространены — пробуем соседство, затем суффикс от корня
  if (p.id === 'py') {
    const sibling = normalize(join(dirname(fromRel), segs.join('/')))
    if (!sibling.startsWith('..')) {
      const hit = matchTail(sibling, p, index).filter((f) => f === sibling || f.startsWith(`${sibling}.`) || f.startsWith(`${sibling}/`))
      const exact = nearest(fromRel, hit)
      if (exact) return [exact]
    }
  }
  // Соседство уже проверено выше и корня не требует; суффиксный поиск по одному
  // сегменту — уже догадка о чужой библиотеке
  if (!bareAllowed(segs, false)) return []
  for (const tail of tails(segs, p)) {
    const hit = nearest(fromRel, matchTail(tail, p, index))
    if (hit) return [hit]
  }
  return []
}

/**
 * Резолв формы decl: имя ищется среди ОБЪЯВЛЕННЫХ проектом пространств.
 * `import a.b.C` → файл, который объявил `package a.b` и называется C.
 * `using A.B;` в C# — зависимость от пространства целиком (файловых импортов в
 * языке нет), поэтому рёбра ко всем его файлам; но пространство, покрывающее
 * заметную долю проекта, ребром ничего не сообщает — от такого молчим.
 */
function resolveDecl(fromRel: string, spec: string, p: LangPack, index: ImportIndex): string[] {
  const key = nsKey(spec)
  if (!key) return []
  const segs = key.split('.')
  const wide = Math.max(8, Math.floor(index.total * 0.1))

  // Пространство целиком: `using A.B;`, `import a.b.*;`
  const wholeNs = segs[segs.length - 1] === '*' ? segs.slice(0, -1).join('.') : key
  const whole = index.byNs.get(wholeNs) ?? []
  if (whole.length > 0 && (p.id === 'cs' || segs[segs.length - 1] === '*')) {
    if (whole.length > wide) return []
    return whole
  }

  // Тип внутри пространства: последний сегмент — имя файла
  if (segs.length >= 2) {
    const owner = index.byNs.get(segs.slice(0, -1).join('.')) ?? []
    const name = segs[segs.length - 1]
    const hit = nearest(fromRel, owner.filter((f) => baseOf(f) === name))
    if (hit) return [hit]
  }
  if (whole.length === 1) return whole

  // Объявлений нет вовсе (проект без пространств имён) — последний шанс —
  // путь ровно по имени; отбрасывать сегменты здесь нельзя, иначе `java.util.List`
  // поймал бы собственный List проекта
  const direct = nearest(fromRel, matchTail(segs.join('/'), p, index))
  return direct ? [direct] : []
}

/**
 * Резолв формы name: имя типа ищется среди ОБЪЯВЛЕННЫХ проектом (typeDecl).
 * Квалифицированное имя обязано совпасть пространством с объявлением; голое
 * указывает на тип БЕЗ пространства — так разрешает голую строку класса
 * автозагрузчик, и потому надпись в интерфейсе не поймает одноимённый класс
 * из чужого namespace. У языков без объявляемых пространств (Ruby) все типы
 * глобальны, и голое имя сверяется со всеми. Совпадение регистра требуется
 * точное: PHP формально регистронезависим, но неточный регистр в живом коде —
 * скорее совпадение слов, чем ссылка, а догадка в графе хуже пропуска.
 */
function resolveName(fromRel: string, spec: string, p: LangPack, index: ImportIndex): string[] {
  const segs = spec.split(p.sep).filter(Boolean)
  if (segs.length === 0) return []
  const name = segs[segs.length - 1]
  if (name.length < 2) return []
  const all = index.byType.get(name) ?? []
  if (all.length === 0 || all.length > MAX_SAME_NAME) return []
  const ns = segs.length > 1 && p.nsDecl !== null ? nsKey(segs.slice(0, -1).join('.')) : null
  const candidates = all
    .filter((t) => (ns !== null ? t.ns !== null && nsKey(t.ns) === ns : p.nsDecl === null || t.ns === null))
    .map((t) => t.path)
  const hit = nearest(fromRel, candidates)
  return hit ? [hit] : []
}

/** Все файлы проекта, на которые указывает спецификатор (обычно ноль или один). */
export function resolveSpec(fromRel: string, spec: ImportSpec, index: ImportIndex): string[] {
  const p = packOf(fromRel)
  if (!p) return []
  // Резолв зависит от импортёра только через его КАТАЛОГ — и относительные
  // пути, и близость считаются от него. Значит соседи по каталогу с одним и тем
  // же спецификатором получают один и тот же ответ, и повторять работу незачем
  const key = `${dirname(fromRel)}\n${spec.form}\n${spec.spec}`
  const memo = index.memo.get(key)
  if (memo) return memo.filter((f) => f !== fromRel)
  const hit =
    spec.form === 'path'
      ? resolvePath(fromRel, spec.spec, p, index)
      : spec.form === 'symbol'
        ? resolveSymbol(fromRel, spec.spec, p, index)
        : spec.form === 'name'
          ? resolveName(fromRel, spec.spec, p, index)
          : resolveDecl(fromRel, spec.spec, p, index)
  index.memo.set(key, hit)
  return hit.filter((f) => f !== fromRel)
}

/**
 * Резолв спецификатора в rel-путь проекта или null — форма для вызова по одному
 * списку путей (без содержимого). Формы decl здесь недоступны: пространства имён
 * объявлены В файлах, а их тут нет. Индекс запоминается по самому набору файлов —
 * повторные вызовы на том же наборе не перестраивают его заново.
 */
const indexCache = new WeakMap<Set<string>, ImportIndex>()

export function resolveImport(fromRel: string, spec: string, files: Set<string>): string | null {
  let index = indexCache.get(files)
  if (!index) {
    index = buildImportIndex([...files].map((rel) => ({ rel })))
    indexCache.set(files, index)
  }
  const p = packOf(fromRel)
  if (!p) return null
  const form: SpecForm = p.patterns.some((x) => x.form === 'path') ? 'path' : p.patterns[0].form
  return resolveSpec(fromRel, { spec, form }, index)[0] ?? null
}
