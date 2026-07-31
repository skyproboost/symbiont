/**
 * Смоук собранной формы: доказывает, что web-tree-sitter и wasm-грамматики
 * живы ПОСЛЕ сборки (канарейка каналов слой 1 не трогает — он бежит в детаче).
 * Запускается bundle.ts из plugin/dist; ненулевой exit = артефакт неполный.
 */
import { fileMetrics } from '../layer1/ast'

const m = await fileMetrics('.js', 'try { f() } catch (e) {}\n')
console.log(JSON.stringify(m))
process.exit(m !== null && m.tryCount === 1 && m.catchCount === 1 ? 0 : 1)
