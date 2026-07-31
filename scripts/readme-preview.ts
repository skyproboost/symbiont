/**
 * Генератор локального превью README как на GitHub: читает README.md и
 * пишет readme-preview.html (самодостаточный, открывается двойным кликом).
 * Рендер — marked + github-markdown-css + mermaid (CDN); бейджи — обычные <img>
 * с shields.io. Контент вшит через JSON.stringify (без проблем экранирования).
 *
 * Запуск: bun run scripts/readme-preview.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const md = readFileSync(join(root, 'README.md'), 'utf8')

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Symbiont — README (превью GitHub)</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown-light.min.css">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
  mermaid.initialize({ startOnLoad: false, theme: 'default' })
  window.__mermaid = mermaid
</script>
<style>
  body { background:#ffffff; margin:0; padding:0; }
  .markdown-body { box-sizing:border-box; max-width:980px; margin:0 auto; padding:45px; }
  .mermaid { background:#f6f8fa; border:1px solid #d0d7de; border-radius:8px; padding:16px; margin:16px 0; text-align:center; }
  @media (max-width:820px){ .markdown-body{ padding:15px; } }
</style>
</head>
<body>
<article id="content" class="markdown-body"></article>
<script id="md" type="application/json">${JSON.stringify(md)}</script>
<script>
  const source = JSON.parse(document.getElementById('md').textContent)
  const el = document.getElementById('content')
  // marked с сохранением mermaid-блоков как pre.mermaid для отрисовки
  const renderer = new marked.Renderer()
  const origCode = renderer.code.bind(renderer)
  renderer.code = (code, lang) => {
    const c = typeof code === 'object' ? code.text : code
    const l = typeof code === 'object' ? code.lang : lang
    if (l === 'mermaid') return '<pre class="mermaid">' + c.replace(/</g,'&lt;') + '</pre>'
    return origCode(code, lang)
  }
  el.innerHTML = marked.parse(source, { renderer })
  const run = () => window.__mermaid && window.__mermaid.run({ querySelector: '.mermaid' })
  window.__mermaid ? run() : setTimeout(run, 400)
</script>
</body>
</html>`

const out = join(root, 'readme-preview.html')
writeFileSync(out, html, 'utf8')
console.log('Превью README готово:', out)
console.log('Открой этот файл в браузере (двойной клик) — увидишь страницу как на GitHub.')
