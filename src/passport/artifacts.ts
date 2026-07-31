/**
 * Детект типов артефактов: из чего СДЕЛАН проект — не предполагая, что это код
 * или веб. Классы обнаруживаются по расширениям (данные, не хардкод-направления);
 * распределение показывает природу проекта, а применимые универсальные оси
 * качества активируются от найденного материала.
 *
 * Это фундамент автономного init и будущего /sym-elevate: «тензор»
 * оси-качества × типы-артефактов начинается здесь.
 */

import { t } from '../core/i18n'

export type ArtifactClass =
  | 'код'
  | 'контент'
  | 'разметка-стили'
  | 'данные'
  | 'конфиг-инфра'
  | 'дизайн'
  | 'офис'
  | 'медиа'
  | 'прочее'

const EXT_CLASS: Record<string, ArtifactClass> = {
  // код
  '.ts': 'код', '.js': 'код', '.mjs': 'код', '.cjs': 'код', '.tsx': 'код', '.jsx': 'код', '.vue': 'код',
  '.py': 'код', '.go': 'код', '.php': 'код', '.rb': 'код', '.java': 'код', '.cs': 'код', '.kt': 'код',
  '.rs': 'код', '.c': 'код', '.cpp': 'код', '.h': 'код', '.hpp': 'код', '.swift': 'код', '.scala': 'код',
  '.lua': 'код', '.dart': 'код', '.sh': 'код', '.ps1': 'код', '.sql': 'код', '.r': 'код', '.pl': 'код',
  // контент
  '.md': 'контент', '.mdx': 'контент', '.txt': 'контент', '.rst': 'контент', '.adoc': 'контент',
  // разметка/стили
  '.html': 'разметка-стили', '.htm': 'разметка-стили', '.css': 'разметка-стили', '.scss': 'разметка-стили',
  '.sass': 'разметка-стили', '.less': 'разметка-стили', '.svg': 'разметка-стили',
  // данные
  '.json': 'данные', '.yaml': 'данные', '.yml': 'данные', '.csv': 'данные', '.tsv': 'данные',
  '.xml': 'данные', '.toml': 'данные', '.ndjson': 'данные', '.parquet': 'данные',
  // конфиг/инфра
  '.env': 'конфиг-инфра', '.ini': 'конфиг-инфра', '.conf': 'конфиг-инфра', '.dockerfile': 'конфиг-инфра',
  // дизайн
  '.fig': 'дизайн', '.sketch': 'дизайн', '.psd': 'дизайн', '.ai': 'дизайн', '.xd': 'дизайн',
  '.png': 'дизайн', '.jpg': 'дизайн', '.jpeg': 'дизайн', '.webp': 'дизайн', '.gif': 'дизайн', '.ico': 'дизайн',
  // офис
  '.docx': 'офис', '.doc': 'офис', '.pptx': 'офис', '.ppt': 'офис', '.xlsx': 'офис', '.xls': 'офис', '.pdf': 'офис',
  // медиа
  '.mp4': 'медиа', '.mov': 'медиа', '.webm': 'медиа', '.mp3': 'медиа', '.wav': 'медиа', '.avif': 'медиа',
}

/** Класс файла: спец-имена инфры → по имени, иначе по расширению. */
export function classify(fileName: string, ext: string): ArtifactClass {
  const lower = fileName.toLowerCase()
  if (/(^|\/)(dockerfile|makefile|jenkinsfile)$/.test(lower) || /^\.(gitignore|npmrc|editorconfig|dockerignore)$/.test(lower)) {
    return 'конфиг-инфра'
  }
  if (/docker-compose[.-]/.test(lower) || /(^|\/)\.github\//.test(lower)) return 'конфиг-инфра'
  return EXT_CLASS[ext] ?? 'прочее'
}

export interface ArtifactProfile {
  counts: Record<ArtifactClass, number>
  total: number
  dominant: ArtifactClass | null
  /** Классы, присутствующие заметно (≥5% или ≥3 файлов) — активные материалы. */
  present: ArtifactClass[]
}

/** relPaths — форвард-слэш пути всех файлов проекта (включая не-код). */
export function artifactProfile(relPaths: Array<{ name: string; ext: string }>): ArtifactProfile {
  const counts = {} as Record<ArtifactClass, number>
  for (const { name, ext } of relPaths) {
    const c = classify(name, ext)
    counts[c] = (counts[c] ?? 0) + 1
  }
  const total = relPaths.length
  let dominant: ArtifactClass | null = null
  let max = 0
  for (const [c, n] of Object.entries(counts) as Array<[ArtifactClass, number]>) {
    if (c !== 'прочее' && n > max) {
      max = n
      dominant = c
    }
  }
  // «Материал» проекта — класс минимум из 3 файлов (1–2 стрелка не в счёт),
  // и заметный по доле на крупных репозиториях (≥1% отсеивает случайный мусор).
  const present = (Object.entries(counts) as Array<[ArtifactClass, number]>)
    .filter(([c, n]) => c !== 'прочее' && n >= 3 && n / Math.max(total, 1) >= 0.01)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
  return { counts, total, dominant, present }
}

/**
 * Универсальные оси качества, активируемые составом артефактов.
 * Безопасность и корректность — всегда; остальное — от материала.
 * Оси = линзы (модель их знает), не хардкод-правила проекта.
 */
const CLASS_AXES: Record<ArtifactClass, string[]> = {
  'код': ['корректность', 'производительность', 'поддерживаемость', 'отказоустойчивость', 'наблюдаемость'],
  'контент': ['находимость/SEO', 'связность/перелинковка', 'полнота/покрытие', 'доступность', 'легитимность/контекст'],
  'разметка-стили': ['доступность', 'производительность', 'совместимость', 'находимость/SEO'],
  'данные': ['целостность данных', 'корректность', 'полнота/покрытие'],
  'конфиг-инфра': ['отказоустойчивость', 'безопасность', 'поставляемость', 'масштабируемость (горизонт+вертикаль)'],
  'дизайн': ['доступность', 'согласованность', 'UX/эргономика'],
  'офис': ['полнота/покрытие', 'согласованность', 'доступность'],
  'медиа': ['производительность', 'доступность', 'стоимость'],
  'прочее': [],
}

export function activeAxes(profile: ArtifactProfile): string[] {
  const axes = new Set<string>(['безопасность', 'корректность']) // всегда
  for (const c of profile.present) for (const a of CLASS_AXES[c]) axes.add(a)
  return [...axes]
}

const CLASS_LABEL: Record<ArtifactClass, string> = {
  'код': 'код', 'контент': 'контент/тексты', 'разметка-стили': 'разметка/стили', 'данные': 'данные',
  'конфиг-инфра': 'конфиг/инфра', 'дизайн': 'дизайн/графика', 'офис': 'офис-документы', 'медиа': 'медиа', 'прочее': 'прочее',
}

/**
 * Стоячая стойка качества: пара «амбиция + сдержанность» (аксиома §9 концепта).
 * Оси выводятся из состава (без хардкода), сдержанность гасит оверинжиниринг.
 * Действует в каждой сессии; конкретную волю /sym-init подаёт отдельно (побеждает).
 */
export function renderQualityStance(profile: ArtifactProfile): string {
  if (profile.present.length === 0) return '' // нет материала — нет проекта, молчим
  const axes = activeAxes(profile)
  return [
    t('## Стойка качества (стоячая; действует без повторения в промптах)', '## Quality stance (standing; applies without being repeated in prompts)'),
    '',
    `- цель: топ-1 по осям, применимым к этому проекту — ${axes.join(', ')}`,
    '- ограничение: улучшения сверх задачи — предлагать, не делать; если правка описывается одним предложением — без церемоний',
  ].join('\n')
}

/** Секция «Состав проекта» для сводки. */
export function renderArtifacts(profile: ArtifactProfile): string {
  if (profile.total === 0 || profile.present.length === 0) return ''
  const lines = [t('## Состав проекта (из чего сделан; универсальные оси активируются по материалу)', '## What this project is made of (universal quality axes switch on by material)'), '']
  for (const c of profile.present) {
    const n = profile.counts[c]
    const pct = Math.round((n / profile.total) * 100)
    lines.push(`- ${CLASS_LABEL[c]} — ${n} файлов (${pct}%)`)
  }
  lines.push(`- активные оси качества: ${activeAxes(profile).join(', ')}`)
  return lines.join('\n')
}
