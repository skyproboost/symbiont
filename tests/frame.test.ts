import { describe, it, expect } from 'bun:test'
import {
  sensitiveDirections,
  deriveFrameCandidates,
  compileFrame,
  renderFrame,
  buildFrame,
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
    expect(block).toContain('/sym-charter')
  })
  it('buildFrame: несенситивный проект → пусто (ноль токенов)', () => {
    expect(buildFrame('CLI-утилита для сборки. Быстро, без зависимостей.')).toBe('')
  })
  it('buildFrame: сенситив есть, но дисклеймеров нет → пусто (не выдумываем)', () => {
    expect(buildFrame('Медицинский сервис про анализы крови и лечение пациентов.')).toBe('')
  })
})
