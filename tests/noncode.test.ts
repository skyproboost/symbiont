import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { mineCsv, mineText, readZipEntries, mineOffice, isNonCodeMinable, extractContent } from '../src/miner/noncode'

describe('mineCsv', () => {
  it('определяет разделитель, колонки, число строк', () => {
    const c = mineCsv('фраза;частота;регион\nвич;1013921;225\nгерпес;954898;225')
    expect(c.delimiter).toBe(';')
    expect(c.columns).toEqual(['фраза', 'частота', 'регион'])
    expect(c.rows).toBe(2)
  })
  it('таб-разделитель (tsv)', () => {
    expect(mineCsv('a\tb\tc\n1\t2\t3').delimiter).toBe('\t')
  })
})

describe('mineText', () => {
  it('заголовки, слова, строки', () => {
    const t = mineText('# Заголовок\n\nтекст тут\n\n## Подзаголовок\nещё слова здесь')
    expect(t.headings).toContain('Заголовок')
    expect(t.headings).toContain('Подзаголовок')
    expect(t.words).toBeGreaterThan(4)
    expect(t.lines).toBe(6)
  })
})

/** Собрать валидный zip из {имя: содержимое} — локальные заголовки + deflate. */
function buildZip(entries: Record<string, string>): Buffer {
  const chunks: Buffer[] = []
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = Buffer.from(content, 'utf8')
    const comp = deflateRawSync(raw)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0)
    h.writeUInt16LE(20, 4) // version
    h.writeUInt16LE(0, 6) // flags (без потокового дескриптора)
    h.writeUInt16LE(8, 8) // method deflate
    h.writeUInt32LE(0, 10) // time
    h.writeUInt32LE(0, 14) // crc (ридер не проверяет)
    h.writeUInt32LE(comp.length, 18)
    h.writeUInt32LE(raw.length, 22)
    h.writeUInt16LE(nameBuf.length, 26)
    h.writeUInt16LE(0, 28) // extra
    chunks.push(h, nameBuf, comp)
  }
  return Buffer.concat(chunks)
}

describe('readZipEntries', () => {
  it('читает и распаковывает записи deflate', () => {
    const zip = buildZip({ 'a.txt': 'привет мир', 'dir/b.xml': '<x>данные</x>' })
    const entries = readZipEntries(zip)
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.xml'])
    expect(entries[0].data.toString('utf8')).toBe('привет мир')
    expect(entries[1].data.toString('utf8')).toBe('<x>данные</x>')
  })
  it('мусор → пустой список, не падение', () => {
    expect(readZipEntries(Buffer.from('не zip вовсе'))).toEqual([])
  })
})

describe('mineOffice', () => {
  it('docx: текст из word/document.xml, счёт абзацев', () => {
    const zip = buildZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Первый абзац</w:t></w:r></w:p><w:p><w:r><w:t>Второй</w:t></w:r></w:p></w:body></w:document>',
    })
    const o = mineOffice(zip, '.docx')
    expect(o.format).toBe('docx')
    expect(o.text).toContain('Первый абзац')
    expect(o.text).toContain('Второй')
    expect(o.units).toBe(2) // два <w:p>
  })
  it('pptx: текст слайдов, счёт = число слайдов', () => {
    const zip = buildZip({
      'ppt/slides/slide1.xml': '<p:sld><a:t>Слайд один</a:t></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:t>Слайд два</a:t></p:sld>',
    })
    const o = mineOffice(zip, '.pptx')
    expect(o.units).toBe(2)
    expect(o.text).toContain('Слайд один')
    expect(o.text).toContain('Слайд два')
  })
  it('битый буфер → пустой текст, не падение', () => {
    expect(mineOffice(Buffer.from('мусор'), '.docx').text).toBe('')
  })
})

describe('isNonCodeMinable / extractContent', () => {
  it('распознаёт офис/csv/текст, отвергает код', () => {
    expect(isNonCodeMinable('.docx')).toBe(true)
    expect(isNonCodeMinable('.csv')).toBe(true)
    expect(isNonCodeMinable('.md')).toBe(true)
    expect(isNonCodeMinable('.ts')).toBe(false)
  })

  it('extractContent на реальных файлах диска', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-nc-'))
    writeFileSync(join(dir, 'data.csv'), 'ключ,объём\nвпч,31383\nвич,82030')
    writeFileSync(join(dir, 'doc.md'), '# Инструкция\nтекст документа тут')
    writeFileSync(join(dir, 'deck.pptx'), buildZip({ 'ppt/slides/slide1.xml': '<a:t>Титульный слайд</a:t>' }))

    const csv = extractContent(join(dir, 'data.csv'), '.csv')!
    expect(csv).toContain('таблица 2 строк')
    expect(csv).toContain('ключ, объём')

    const md = extractContent(join(dir, 'doc.md'), '.md')!
    expect(md).toContain('заголовки: Инструкция')

    const pptx = extractContent(join(dir, 'deck.pptx'), '.pptx')!
    expect(pptx).toContain('pptx')
    expect(pptx).toContain('Титульный слайд')

    expect(extractContent(join(dir, 'nope.ts'), '.ts')).toBe(null)
    rmrf(dir)
  })
})

describe('elevate использует не-код выборку', () => {
  it('проект без кода (только контент/данные) даёт выборку elevate', async () => {
    const { buildContext } = await import('../src/elevate/engine')
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-nc-proj-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-nc-data-'))
    writeFileSync(join(dataDir, 'SUMMARY.md'), '# Паспорт\n\n## Состав проекта\n\n- контент/тексты — 10 файлов (60%)\n- данные — 5 файлов (30%)\n')
    for (let i = 0; i < 4; i++) writeFileSync(join(proj, `article${i}.md`), `# Статья ${i}\nсодержательный текст статьи номер ${i} про анализы`)
    writeFileSync(join(proj, 'keys.csv'), 'фраза,частота\nвпч,31383')

    const ctx = buildContext(proj, dataDir)
    expect(ctx.samples.length).toBeGreaterThan(0) // граф пуст, но не-код выборка есть
    const joined = ctx.samples.map((s) => s.file).join(' ')
    expect(joined).toMatch(/\.md|\.csv/)
    rmrf(proj)
    rmrf(dataDir)
  })
})
