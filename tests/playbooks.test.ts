import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLAYBOOKS, playbooksFor, renderPlaybookBrief } from '../src/domains/playbooks'
import { fileDomains } from '../src/passport/stack'
import { handlePostTool } from '../src/hooks/post-tool-core'
import { slugOf } from '../src/hooks/session-start-core'
import { openDb } from '../src/core/db'

describe('целостность плейбуков', () => {
  it('каждый: непустой чек-лист/провалы/источник/триггеры', () => {
    expect(PLAYBOOKS.length).toBeGreaterThanOrEqual(5)
    for (const p of PLAYBOOKS) {
      expect(p.checklist.length).toBeGreaterThanOrEqual(3)
      expect(p.pitfalls.length).toBeGreaterThanOrEqual(2)
      expect(p.source.length).toBeGreaterThan(8)
      expect(p.triggers.length).toBeGreaterThan(0)
    }
  })
  it('пороги с числами реальны (Postgres батчи, CWV, HSTS, k8s ratio)', () => {
    const db = PLAYBOOKS.find((p) => p.domain === 'база данных')!
    expect(db.thresholds?.join(' ')).toContain('100K')
    const fe = PLAYBOOKS.find((p) => p.domain === 'фронтенд')!
    expect(fe.thresholds?.join(' ')).toContain('2.5с')
    expect(fe.thresholds?.join(' ')).toContain('200мс')
    const dep = PLAYBOOKS.find((p) => p.domain === 'деплой/оркестрация')!
    expect(dep.thresholds?.join(' ')).toContain('4:1') // requests:limits
    expect(dep.thresholds?.join(' ')).toContain('70%') // HPA
  })
})

describe('playbooksFor', () => {
  it('nuxt+postgres → фронтенд + база данных + node-бэкенд(nitro нет) активны', () => {
    const active = playbooksFor({ frameworks: ['nuxt'], infra: ['postgres'], domains: ['база данных', 'SEO'] }).map((p) => p.domain)
    expect(active).toContain('фронтенд')
    expect(active).toContain('база данных')
    expect(active).toContain('SEO')
  })
  it('kubernetes/docker/pm2 → плейбук деплоя/оркестрации', () => {
    const active = playbooksFor({ frameworks: [], infra: ['kubernetes', 'docker'], domains: ['оркестрация/масштабирование'] }).map((p) => p.domain)
    expect(active).toContain('деплой/оркестрация')
  })
  it('пустой стек → нет плейбуков', () => {
    expect(playbooksFor({ frameworks: [], infra: [], domains: [] })).toEqual([])
  })
})

describe('fileDomains', () => {
  it('файл миграции → база данных; компонент → фронтенд; nginx-конфиг → веб-сервер', () => {
    expect(fileDomains('server/db/migrations/0001.sql')).toContain('база данных')
    expect(fileDomains('app/components/Card.vue')).toContain('фронтенд')
    expect(fileDomains('nginx/site.conf')).toContain('веб-сервер')
    expect(fileDomains('README.md')).toEqual([])
  })
})

describe('renderPlaybookBrief', () => {
  it('срез с эталоном, порогами, источником', () => {
    const brief = renderPlaybookBrief(PLAYBOOKS.find((p) => p.domain === 'база данных')!)
    expect(brief).toContain('плейбук «база данных»')
    expect(brief).toContain('индекс')
    expect(brief).toContain('источник:')
  })
})

describe('плейбук в PostToolUse', () => {
  function world() {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-pb-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-pb-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const db = openDb(join(dataDir, 'passport.db'))
    db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL, in_deg INTEGER, out_deg INTEGER)')
    db.close()
    mkdirSync(join(proj, 'server', 'db', 'migrations'), { recursive: true })
    return { proj, dataRoot }
  }

  it('касание файла миграции → срез плейбука БД один раз за сессию', () => {
    const { proj, dataRoot } = world()
    writeFileSync(join(proj, 'server', 'db', 'migrations', '0001.sql'), 'CREATE TABLE x();')
    const out = handlePostTool(
      { cwd: proj, session_id: 's1', tool_name: 'Read', tool_input: { file_path: join(proj, 'server/db/migrations/0001.sql') } },
      dataRoot,
    )
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('плейбук «база данных»')
    expect(ctx).toContain('индекс')
    // повтор — молчание (дедуп)
    const out2 = handlePostTool(
      { cwd: proj, session_id: 's1', tool_name: 'Read', tool_input: { file_path: join(proj, 'server/db/migrations/0002.sql') } },
      dataRoot,
    )
    expect(out2.hookSpecificOutput?.additionalContext ?? '').not.toContain('плейбук «база данных»')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('файл без направления с плейбуком → молчание', () => {
    const { proj, dataRoot } = world()
    writeFileSync(join(proj, 'notes.md'), '# заметки')
    const out = handlePostTool(
      { cwd: proj, session_id: 's2', tool_name: 'Read', tool_input: { file_path: join(proj, 'notes.md') } },
      dataRoot,
    )
    expect(out).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
  })
})
