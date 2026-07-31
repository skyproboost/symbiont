/**
 * Сборка устанавливаемого артефакта plugin/ (долг №16 — корневой фикс раздувания
 * кэша установки: ~300МБ node_modules на релиз → ~30МБ артефакта).
 *
 * Поток: входы → bun build (плоский dist, web-tree-sitter инлайнится) →
 * wasm-поднабор (только грамматики слоя 1 + ядро tree-sitter) → манифесты и
 * скиллы с путями на dist → смоук собранной формы → .build.json (хэш входов —
 * его сверяет selflint: несвежий бандл падает красным до релиза).
 * Запуск: bun run scripts/bundle.ts. Проверка каналов бандла: canary.ts --dist.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ENTRY_SOURCES, collectBundleInputs, bundleInputsHash, rewriteEntryPaths, retargetManifestRuntime, retargetSkillRuntime } from '../src/bundle/core'
import { grammarNames } from '../src/layer1/ast'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'plugin')
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const inputs = collectBundleInputs(ROOT)
const hash = bundleInputsHash(inputs)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'dist'), { recursive: true })

// 1) Сборка. Все выходы (входы и чанки) плоско в dist: рантайм-резолвы
// (detach.ts — сосед auto-learn.js; ast.ts — ../wasm) пляшут от import.meta.dirname,
// вложенный каталог чанков сломал бы их молча.
const build = await Bun.build({
  entrypoints: ENTRY_SOURCES.map((e) => join(ROOT, e)),
  outdir: join(OUT, 'dist'),
  // Цель node, а не bun: артефакт обязан исполняться обоими рантаймами, а
  // выход под node — обычный JS, который bun читает без оговорок. Обратное
  // неверно: цель bun вправе оставить в коде bun-специфику.
  target: 'node',
  splitting: true,
  naming: { entry: '[name].[ext]', chunk: '[name]-[hash].[ext]' },
  define: { __SYM_PROJECTION_VERSION__: JSON.stringify(`bundle-${hash.slice(0, 12)}`) },
})
if (!build.success) {
  for (const log of build.logs) console.error(String(log))
  fail('bun build не собрался')
}
for (const e of ENTRY_SOURCES) {
  const name = e.replace(/^.*\//, '').replace(/\.ts$/, '.js')
  if (!existsSync(join(OUT, 'dist', name))) fail(`в dist нет точки входа ${name}`)
}

// 2) WASM: ядро web-tree-sitter + только грамматики слоя 1 (единый источник —
// EXT_LANG в ast.ts). Отсутствие грамматики = неполный артефакт, падаем.
mkdirSync(join(OUT, 'wasm'), { recursive: true })
const coreWasm = join(ROOT, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm')
if (!existsSync(coreWasm)) fail('нет node_modules/web-tree-sitter/tree-sitter.wasm — bun install?')
cpSync(coreWasm, join(OUT, 'wasm', 'tree-sitter.wasm'))
for (const g of grammarNames()) {
  const src = join(ROOT, 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${g}.wasm`)
  if (!existsSync(src)) fail(`нет грамматики ${g} в tree-sitter-wasms`)
  cpSync(src, join(OUT, 'wasm', `tree-sitter-${g}.wasm`))
}

// 3) Манифесты и скиллы: те же файлы, ссылки — на форму поставки.
// Маркер модульности рядом с выходами: без него node прочитает .js как CommonJS
// и упадёт на первом import. В каталоге установки package.json искать негде —
// значит его кладём мы (в репозитории роль маркера играет корневой package.json).
mkdirSync(join(OUT, 'hooks'), { recursive: true })
writeFileSync(join(OUT, 'dist', 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8')
const manifest = (text: string): string => retargetManifestRuntime(rewriteEntryPaths(text))
writeFileSync(join(OUT, 'hooks', 'hooks.json'), manifest(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')), 'utf8')
writeFileSync(join(OUT, '.mcp.json'), manifest(readFileSync(join(ROOT, '.mcp.json'), 'utf8')), 'utf8')
mkdirSync(join(OUT, '.claude-plugin'), { recursive: true })
cpSync(join(ROOT, '.claude-plugin', 'plugin.json'), join(OUT, '.claude-plugin', 'plugin.json'))
const skillsRoot = join(ROOT, 'skills')
for (const name of readdirSync(skillsRoot)) {
  if (!statSync(join(skillsRoot, name)).isDirectory()) continue
  for (const f of readdirSync(join(skillsRoot, name))) {
    mkdirSync(join(OUT, 'skills', name), { recursive: true })
    const src = join(skillsRoot, name, f)
    // Скиллу переписываются и путь, и рантайм: в репозитории он бежит .ts под
    // bun, в поставке — собранный .js под node (см. retargetSkillRuntime)
    if (/\.md$/.test(f)) writeFileSync(join(OUT, 'skills', name, f), retargetSkillRuntime(rewriteEntryPaths(readFileSync(src, 'utf8'))), 'utf8')
    else cpSync(src, join(OUT, 'skills', name, f))
  }
}

// 4) Смоук собранной формы: слой 1 должен парсить из dist (wasm-резолв, инлайн
// web-tree-sitter). Прогон обоими рантаймами — артефакт заявлен рантайм-
// нейтральным, и заявление проверяется здесь, а не на машине владельца.
// Node обязателен: именно его зовут манифесты поставки; собрать, не проверив
// поставляемый путь, — то же молчание, только на этапе релиза.
for (const runner of ['bun', 'node']) {
  const smoke = spawnSync(runner, [join(OUT, 'dist', 'smoke.js')], { encoding: 'utf8', timeout: 30_000, windowsHide: true })
  if (smoke.error && (smoke.error as NodeJS.ErrnoException).code === 'ENOENT') fail(`нет рантайма ${runner} — артефакт заявлен рантайм-нейтральным, проверить это нечем`)
  if (smoke.status !== 0) fail(`смоук слоя 1 в бандле под ${runner}: exit=${smoke.status} ${(smoke.stderr ?? '').slice(0, 300)}`)
}

// 5) Манифест свежести — только после успешного смоука.
writeFileSync(
  join(OUT, 'dist', '.build.json'),
  JSON.stringify({ hash, builtAt: new Date().toISOString(), entries: ENTRY_SOURCES.length, grammars: grammarNames().length }, null, 1),
  'utf8',
)

const sizeOf = (dir: string): number => {
  let s = 0
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    s += statSync(p).isDirectory() ? sizeOf(p) : statSync(p).size
  }
  return s
}
const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)}МБ`
console.log(` ✓ plugin/ собран: dist ${mb(sizeOf(join(OUT, 'dist')))} · wasm ${mb(sizeOf(join(OUT, 'wasm')))} · хэш ${hash.slice(0, 12)}`)
console.log('   проверка каналов: bun run scripts/canary.ts --dist')
