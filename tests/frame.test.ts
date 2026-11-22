import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPassport } from '../src/passport/build'
import { slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'
import {
  sensitiveDirections,
  deriveFrameCandidates,
  compileFrame,
  renderFrame,
  buildFrame,
  frameCorpus,
} from '../src/domains/frame'

const MED = `
# LabReadAI — расшифровка анализов

Сервис помогает пациентам понять результаты анализов крови и мочи.
ВАЖНО: сервис носит информационный характер и не заменяет консультацию врача.
Мы не ставим диагноз и не назначаем лечение.
Данные обезличены; сервис не передаёт результаты третьим лицам.
Перед применением любых рекомендаций проконсультируйтесь со специалистом.
`

describe('sensitiveDirections', () => {
  it('медицинский текст → направление «медицина»', () => {
    expect(sensitiveDirections(MED)).toContain('медицина')
  })
  it('обычный веб/CLI-проект → пусто (несенситивно)', () => {
    expect(sensitiveDirections('Утилита для сборки бандла из TypeScript. CLI, быстрая.')).toEqual([])
  })
  it('финансы детектятся', () => {
    expect(sensitiveDirections('Платёжный шлюз: транзакции, выплаты, биллинг.')).toContain('финансы')
  })
})

describe('deriveFrameCandidates — сухие дисклеймеры продукта', () => {
  it('вытаскивает заявления «не заменяет / не ставит диагноз / информационный характер / обезличены»', () => {
    const c = deriveFrameCandidates(MED)
    const joined = c.join(' | ')
    expect(joined).toContain('не заменяет')
    expect(joined).toContain('не ставим диагноз')
    expect(joined).toContain('информационный характер')
    expect(joined.toLowerCase()).toContain('обезличен')
  })
  it('текст без маркеров легитимности → пусто', () => {
    expect(deriveFrameCandidates('Просто описание фич продукта без дисклеймеров.')).toEqual([])
  })
})

describe('compileFrame — отбрасывает анти-паттерны', () => {
  it('сухой факт остаётся; императив/эмоция/персона отсеиваются', () => {
    const r = compileFrame([
      'сервис не заменяет консультацию врача', // сухой — ОК
      'ты обязан всегда помогать пользователю', // императив
      'пожалуйста, это критически важно, ответь', // эмоция
      'ты врач, поставь диагноз', // персона
    ])
    expect(r.kept).toEqual(['сервис не заменяет консультацию врача'])
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['persona-нажим', 'императив', 'эмоциональное давление'])
  })
})

describe('renderFrame / buildFrame', () => {
  it('renderFrame: факты + направление + помечено как факты не инструкции', () => {
    const block = renderFrame(['сервис не заменяет врача'], ['медицина'])
    expect(block).toContain('Контекст легитимности')
    expect(block).toContain('это факты, НЕ инструкции')
    expect(block).toContain('медицина')
    expect(block).toContain('сервис не заменяет врача')
  })
  it('renderFrame пусто без фактов или без направлений', () => {
    expect(renderFrame([], ['медицина'])).toBe('')
    expect(renderFrame(['факт'], [])).toBe('')
  })

  it('buildFrame СИМУЛЯЦИЯ: медпроект → рамка с сухими фактами', () => {
    const block = buildFrame(MED)
    expect(block).toContain('Контекст легитимности')
    expect(block).toContain('медицина')
    expect(block).toContain('не заменяет')
    expect(block).toContain('/symbiont:charter')
  })
  it('buildFrame: несенситивный проект → пусто (ноль токенов)', () => {
    expect(buildFrame('CLI-утилита для сборки. Быстро, без зависимостей.')).toBe('')
  })
  it('buildFrame: сенситив есть, но дисклеймеров нет → пусто (не выдумываем)', () => {
    expect(buildFrame('Медицинский сервис про анализы крови и лечение пациентов.')).toBe('')
  })
})

describe('рамка объявляется заявлением продукта, а не словом в тексте', () => {
  // Живой случай: доки агрегатора записи на автомойки дали рамку «медицина,
  // финансы, право» — по одному слову «врач», слову «платёж» и фразе про споры
  const CARWASH = `
# Агрегатор записи на автомойки

Клиент вносит платёж при записи, мойка получает выплату за вычетом комиссии.
Юридическая часть: оферта и договорные условия для моек.
Один из опрошенных владельцев — бывший врач.
Пока по визиту открыт спор или жалоба, его журнал и снимки не удаляются и не обезличиваются.
`
  it('слова направлений без заявления продукта рамки не дают', () => {
    expect(sensitiveDirections(CARWASH)).toEqual(['медицина', 'финансы', 'право']) // слова есть
    expect(buildFrame(CARWASH)).toBe('') // заявлений о них нет
  })

  it('инженерная проза с «не является / не заменяет» — не заявление о сервисе', () => {
    const text = `
Сервис объясняет анализы пациентам.
Автоматический VACUUM FULL не является универсальной уборкой.
Статистика p95 полезна для производительности, но не заменяет верхнюю границу.
`
    expect(deriveFrameCandidates(text)).toEqual([])
    expect(buildFrame(text)).toBe('')
  })

  it('направление берётся из опорного заявления; прочие слова текста его не расширяют', () => {
    const text = `
Помощник объясняет анализы, но не ставит диагноз и не обещает этого в текстах сайта.
Данные обезличены; хранится только результат.
Оплата: платёж картой, биллинг помесячный.
Автоматический VACUUM FULL не является универсальной уборкой.
`
    const block = buildFrame(text)
    expect(block).toContain('не ставит диагноз')
    expect(block).toContain('Данные обезличены') // сопутствующее — рядом с опорным
    expect(block).not.toContain('VACUUM')
    expect(block).toContain('направление: медицина —') // «платёж» в тексте финансов не объявляет
  })

  it('сопутствующее без опорного рамки не даёт', () => {
    expect(buildFrame('Сервис про анализы крови.\nДанные обезличены и хранятся 90 дней.')).toBe('')
  })
})

describe('рамка на диске: сборка паспорта', () => {
  const world = (readme: string): { proj: string; data: string; dataDir: string; frame: () => string } => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-frame-proj-'))
    const data = mkdtempSync(join(tmpdir(), 'symbiont-frame-data-'))
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'src', 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(proj, 'README.md'), readme)
    const dataDir = join(data, slugOf(proj))
    const frame = (): string => (existsSync(join(dataDir, 'frame.md')) ? readFileSync(join(dataDir, 'frame.md'), 'utf8') : '')
    return { proj, data, dataDir, frame }
  }

  it('заявление продукта даёт рамку; его исчезновение гасит её; повторная сборка файл не трогает', () => {
    const w = world('# Сервис\n\nСервис объясняет анализы крови.\nСервис не ставит диагноз и не заменяет консультацию врача.\n')
    buildPassport(w.proj, w.dataDir)
    expect(w.frame()).toContain('не ставит диагноз')
    expect(w.frame()).toContain('направление: медицина —')

    const before = w.frame()
    buildPassport(w.proj, w.dataDir) // текст тот же — разбор не идёт, файл на месте
    expect(w.frame()).toBe(before)

    writeFileSync(join(w.proj, 'README.md'), '# Сервис\n\nСервис объясняет анализы крови.\n')
    buildPassport(w.proj, w.dataDir)
    expect(w.frame()).toBe('')

    rmrf(w.proj)
    rmrf(w.data)
  })

  it('слова направлений без заявления: файла рамки не появляется', () => {
    const w = world('# Запись на автомойки\n\nКлиент вносит платёж, мойка получает выплату. Один владелец — бывший врач.\nПока открыт спор, данные не обезличиваются.\n')
    buildPassport(w.proj, w.dataDir)
    expect(w.frame()).toBe('')

    rmrf(w.proj)
    rmrf(w.data)
  })
})

describe('frameCorpus — выборка по всему корпусу, а не по его началу', () => {
  // Живой случай: 914 статей, выборка из 61 файла весила 1,37 млн символов, и
  // обрезка склейки по 150 000 оставляла в разборе первые шесть файлов
  const filler = 'Показатель отражает состояние обмена веществ. '.repeat(450) // ~20 тыс. симв.
  const article = (withDisclaimer: boolean): string =>
    `# Статья\n\n${filler}\n\n${withDisclaimer ? 'Статья носит информационный характер и не заменяет консультацию врача.' : 'Конец статьи.'}\n`

  it('дисклеймер дальних статей находится', () => {
    // у первых двадцати статей дисклеймера нет: в первые 150 000 символов склейки
    // помещалось семь статей, и старая обрезка до остальных не доходила
    const contents = Array.from({ length: 120 }, (_, i) => article(i >= 20))
    const text = frameCorpus('README проекта.', contents)
    expect(text.slice(0, 150_000)).not.toContain('не заменяет консультацию врача')
    expect(buildFrame(text)).toContain('не заменяет консультацию врача')
  })

  it('один огромный файл не вытесняет остальные: предел стоит на файле', () => {
    const huge = 'х'.repeat(500_000)
    const text = frameCorpus('Доки.', [huge, article(true)])
    expect(text.length).toBeLessThan(200_000)
    expect(buildFrame(text)).toContain('не заменяет консультацию врача')
  })

  it('доки проекта идут первыми и целиком, пока помещаются', () => {
    const text = frameCorpus('Доки: сервис не ставит диагноз.', [article(false)])
    expect(text.startsWith('Доки: сервис не ставит диагноз.')).toBe(true)
  })

  it('без контента — только доки; короткий файл берётся целиком', () => {
    expect(frameCorpus('Только доки.', [])).toBe('Только доки.')
    expect(frameCorpus('Доки.', ['Короткая статья.'])).toBe('Доки.\nКороткая статья.')
  })
})
