/**
 * Майнер не-код артефактов: контент/данные/офис становятся видимы паспорту и
 * /sym-elevate, а не только код. Граница честна (концепт §4.1): файл-артефакт
 * майнится (docx/pptx/xlsx = zip+xml, csv, txt); работа внутри GUI — вне платформы.
 *
 * Ноль зависимостей: office распаковывается встроенным zlib (inflateRaw),
 * XML-теги снимаются регуляркой (нам нужен текст и структура, не рендеринг).
 * Fail-open: не распарсилось — пустая выжимка, а не падение.
 */
import { inflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

export interface CsvShape {
  kind: 'csv'
  delimiter: ',' | ';' | '\t'
  columns: string[]
  rows: number
}

/** Форма табличных данных: разделитель, колонки, число строк. */
export function mineCsv(content: string): CsvShape {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0)
  const header = lines[0] ?? ''
  const counts: Array<[CsvShape['delimiter'], number]> = [
    [',', (header.match(/,/g) ?? []).length],
    [';', (header.match(/;/g) ?? []).length],
    ['\t', (header.match(/\t/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  const delimiter = counts[0][1] > 0 ? counts[0][0] : ','
  const columns = header.split(delimiter).map((c) => c.trim()).filter(Boolean)
  return { kind: 'csv', delimiter, columns, rows: Math.max(0, lines.length - 1) }
}

export interface TextShape {
  kind: 'text'
  lines: number
  words: number
  headings: string[]
}

/** Структура текстового/markdown-файла: заголовки, объём. */
export function mineText(content: string): TextShape {
  const lines = content.split(/\r?\n/)
  const headings = lines
    .filter((l) => /^#{1,6}\s+\S/.test(l) || /^={3,}\s*$/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 20)
  const words = (content.match(/\S+/g) ?? []).length
  return { kind: 'text', lines: lines.length, words, headings }
}

interface ZipEntry {
  name: string
  data: Buffer
}

/**
 * Минимальный zip-ридер: последовательный проход по локальным заголовкам
 * (PK\x03\x04). Покрывает офисные файлы Word/PowerPoint/Excel (сжатие deflate,
 * размеры в заголовке). Потоковые дескрипторы (size=0) пропускаются — fail-open.
 */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  const out: ZipEntry[] = []
  let i = 0
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break // не локальный заголовок — конец потока записей
    const method = buf.readUInt16LE(i + 8)
    const compSize = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extraLen = buf.readUInt16LE(i + 28)
    const nameStart = i + 30
    const dataStart = nameStart + nameLen + extraLen
    if (compSize === 0 || dataStart + compSize > buf.length) break // потоковый дескриптор/битьё — стоп
    const name = buf.toString('utf8', nameStart, nameStart + nameLen)
    const raw = buf.subarray(dataStart, dataStart + compSize)
    try {
      out.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) })
    } catch {
      /* энтри не распаковалось — пропускаем */
    }
    i = dataStart + compSize
  }
  return out
}

const stripXml = (xml: string): string =>
  xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export interface OfficeText {
  kind: 'office'
  format: 'docx' | 'pptx' | 'xlsx' | 'unknown'
  text: string
  units: number // абзацы/слайды/строки — грубая мера объёма
}

/** Текст офисного документа: относящиеся XML-части распаковываются и чистятся. */
export function mineOffice(buf: Buffer, ext: string): OfficeText {
  const format = ext === '.docx' ? 'docx' : ext === '.pptx' ? 'pptx' : ext === '.xlsx' ? 'xlsx' : 'unknown'
  const entries = readZipEntries(buf)
  const pick = (re: RegExp): string[] => entries.filter((e) => re.test(e.name)).map((e) => e.data.toString('utf8'))
  let parts: string[] = []
  let units = 0
  if (format === 'docx') {
    parts = pick(/^word\/document\.xml$/)
    units = (parts.join('').match(/<w:p[ >]/g) ?? []).length
  } else if (format === 'pptx') {
    parts = pick(/^ppt\/slides\/slide\d+\.xml$/)
    units = parts.length
  } else if (format === 'xlsx') {
    parts = pick(/^xl\/sharedStrings\.xml$/)
    units = (parts.join('').match(/<si>/g) ?? []).length
  }
  const text = stripXml(parts.join(' ')).slice(0, 20_000)
  return { kind: 'office', format, text, units }
}

export const OFFICE = new Set(['.docx', '.pptx', '.xlsx'])
export const CSVX = new Set(['.csv', '.tsv'])
export const TEXT = new Set(['.txt', '.md', '.mdx', '.rst', '.adoc'])

export function isNonCodeMinable(ext: string): boolean {
  return OFFICE.has(ext) || CSVX.has(ext) || TEXT.has(ext)
}

/**
 * Непрозрачный материал: файл, которым ПОЛЬЗУЮТСЯ, а не который читают.
 * Картинки, шрифты, медиа, архивы, локи и карты сборки.
 *
 * Список один на плагин, потому что ошибка от его расхождения тихая: разбор
 * непокрытого материала такой фильтр имел, а накопление знания о видах — нет,
 * и в общий каталог легла строка «.png: характерный размер ~169 строк». Число
 * получено честно — байты картинки поделили по 0x0A, — и именно поэтому оно
 * выглядит как статистика, а не как ошибка. У бинарного файла нет строк.
 */
const OPAQUE = /^\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|woff2?|ttf|otf|eot|mp[34]|m4a|wav|mov|avi|webm|pdf|zip|gz|tgz|rar|7z|exe|dll|so|dylib|bin|wasm|lock|map|min\.js)$/

export function isOpaqueMaterial(ext: string): boolean {
  return OPAQUE.test(ext.toLowerCase())
}

/** Единый вход: путь+ext → короткая текстовая выжимка для выборки elevate. */
export function extractContent(path: string, ext: string): string | null {
  try {
    if (OFFICE.has(ext)) {
      const o = mineOffice(readFileSync(path), ext)
      return o.text ? `[${o.format}, ${o.units} ед.] ${o.text}` : null
    }
    if (CSVX.has(ext)) {
      const c = mineCsv(readFileSync(path, 'utf8'))
      return `[таблица ${c.rows} строк, колонки: ${c.columns.join(', ')}]`
    }
    if (TEXT.has(ext)) {
      const content = readFileSync(path, 'utf8')
      const t = mineText(content)
      return `[${t.words} слов, заголовки: ${t.headings.slice(0, 8).join(' · ')}]\n${content.slice(0, 3000)}`
    }
    return null
  } catch {
    return null
  }
}
