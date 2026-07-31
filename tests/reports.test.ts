import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStatusReport, buildMapReport } from '../src/cli/reports'
import { handleSessionStart } from '../src/hooks/session-start-core'
import { slugOf } from '../src/hooks/session-start-core'

// Проект с графом и конвенциями
const proj = mkdtempSync(join(tmpdir(), 'symbiont-reports-proj-'))
mkdirSync(join(proj, 'utils'), { recursive: true })
mkdirSync(join(proj, 'api'), { recursive: true })
writeFileSync(join(proj, 'utils', 'core.js'), "var x = 1;\nmodule.exports = { x: x };\n".repeat(4))
writeFileSync(join(proj, 'api', 'service.js'), "var core = require('../utils/core');\nvar y = core.x;\n".repeat(4))
writeFileSync(join(proj, 'app.js'), "var svc = require('./api/service');\nvar core = require('./utils/core');\n")
const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-reports-data-'))
handleSessionStart({ cwd: proj, source: 'startup', session_id: 'r1' }, dataRoot)
const dataDir = join(dataRoot, slugOf(proj))

describe('buildStatusReport', () => {
  it('все секции на месте, бары рисуются', () => {
    const r = buildStatusReport(dataDir)
    expect(r).toContain('Петля фактов')
    expect(r).toContain('█') // бар ярусов
    expect(r).toContain('Граф')
    expect(r).toContain('Сессии')
    expect(r).toContain('открытых 1')
    expect(r).toContain('Каналы')
    expect(r).toContain('чисто')
    expect(r).toContain('Пульс каналов')
    expect(r).toContain('SessionStart')
  })

  it('нет паспорта — честное сообщение', () => {
    const empty = mkdtempSync(join(tmpdir(), 'symbiont-reports-empty-'))
    expect(buildStatusReport(empty)).toContain('ещё не построен')
    rmrf(empty, { recursive: true, force: true })
  })
})

describe('buildMapReport', () => {
  it('обзор: созвездия с композиционной полосой, ядро видно', () => {
    const r = buildMapReport(dataDir)
    expect(r).toContain('карта проекта')
    expect(r).toContain('Состав созвездия')
    expect(r).toContain('utils/')
    expect(r).toContain('api/')
    expect(r).toContain('█') // теплополоса
    expect(r).toContain('✦') // ядро есть
    expect(r).toContain('/symbiont:status <каталог>')
  })

  it('зум в зону: выровненная таблица вход/исход', () => {
    const r = buildMapReport(dataDir, 'utils/')
    expect(r).toContain('зона utils/')
    expect(r).toContain('utils/core.js')
    expect(r).toMatch(/вход\s+исход/)
    expect(r).not.toContain('api/service') // чужая зона не попала
  })

  it('несуществующая зона — подсказка', () => {
    expect(buildMapReport(dataDir, 'nope/')).toContain('не найдена')
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
