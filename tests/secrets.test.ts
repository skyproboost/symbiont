/**
 * Секреты владельца не покидают машину: боевой .env и другие носители секретов
 * плагин не читает вовсе, значения-токены в обычных конфигах не сохраняются,
 * а уже накопленное вычищается первым обращением. Сообщено снаружи как утечка.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { isConfigFile, isSecretCarrier, looksSecret, parseConfigFile, readConfigEntries } from '../src/env/config-graph'
import { buildRulesPrompt, storeRules, readRules } from '../src/env/rules'
import { storeConfigEdges, readConfigEdges, ensureConfigEdgeTable } from '../src/env/links'
import { findDeclaredEnv } from '../src/env/policies'
import { rmrf } from './_helpers'

const SECRET = 'sk-live-4eC39HqLyjWDarjtT1zdp7dc'

describe('носители секретов', () => {
  it('боевой .env и его варианты — не конфигурация; образцы — конфигурация', () => {
    for (const f of ['.env', '.env.local', '.env.production', 'apps/web/.env', '.npmrc', 'deploy/id_rsa', 'certs/server.pem', 'config/secrets.yml', 'gcp-credentials.json']) {
      expect(isSecretCarrier(f)).toBe(true)
      expect(isConfigFile(f)).toBe(false)
    }
    for (const f of ['.env.example', '.env.sample', 'app/.env.template', '.env.dist', 'nuxt.config.ts', 'docker-compose.yml']) {
      expect(isSecretCarrier(f)).toBe(false)
      expect(isConfigFile(f)).toBe(true)
    }
  })

  it('readConfigEntries не открывает боевой .env даже если его подсунули по пути', () => {
    const root = mkdtempSync(join(tmpdir(), 'sym-secrets-'))
    writeFileSync(join(root, '.env'), `STRIPE_KEY=${SECRET}\nREDIS_URL=redis://cache:6379\n`)
    writeFileSync(join(root, '.env.example'), 'STRIPE_KEY=\nREDIS_URL=\n')
    const opened: string[] = []
    const entries = readConfigEntries(root, ['.env', '.env.example'], (p) => {
      opened.push(p)
      return readFileSync(p, 'utf8')
    })
    expect(opened.some((p) => p.endsWith('.env'))).toBe(false)
    expect(entries.every((e) => e.file === '.env.example')).toBe(true)
    expect(JSON.stringify(entries)).not.toContain(SECRET)
    // объявленные переменные — тоже только из образца
    expect([...findDeclaredEnv(root)]).toContain('STRIPE_KEY')
    rmrf(root)
  })
})

describe('значения-секреты в обычных конфигах', () => {
  it('по имени ключа и по форме значения; домены и порты остаются', () => {
    expect(looksSecret('API_TOKEN', 'abc')).toBe(true)
    expect(looksSecret('password', 'hunter2')).toBe(true)
    expect(looksSecret('foo', SECRET)).toBe(true)
    expect(looksSecret('foo', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123')).toBe(true)
    expect(looksSecret('foo', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')).toBe(true)
    expect(looksSecret('REDIS_URL', 'redis://cache:6379')).toBe(false)
    expect(looksSecret('host', 'api.example.com')).toBe(false)
    expect(looksSecret('port', '6379')).toBe(false)
    expect(looksSecret('media-src', 'blob:')).toBe(false)
  })

  it('parseConfigFile оставляет ключ уликой, значение — нет', () => {
    const entries = parseConfigFile('config.json', `{"STRIPE_KEY": "${SECRET}", "REDIS_URL": "redis://cache:6379"}`)
    const stripe = entries.find((e) => e.key === 'STRIPE_KEY')
    expect(stripe).toBeDefined()
    expect(stripe?.value).toBe('')
    expect(JSON.stringify(entries)).not.toContain(SECRET)
    expect(entries.find((e) => e.key === 'REDIS_URL')?.value).toBe('redis://cache:6379')
  })

  it('промпт вывода правил среды не содержит значения-секрета', () => {
    const entries = parseConfigFile('config.json', `{"STRIPE_KEY": "${SECRET}"}`)
    expect(buildRulesPrompt(entries)).not.toContain(SECRET)
  })
})

describe('чистка уже накопленного', () => {
  it('рёбра от боевого .env вычищаются первым же обращением', () => {
    const db = openDb(':memory:')
    ensureConfigEdgeTable(db)
    db.run("INSERT INTO config_edges(config_file, code_file, via, config_key, token) VALUES('.env','src/pay.ts','лексика','STRIPE_KEY',?)", SECRET)
    db.run("INSERT INTO config_edges(config_file, code_file, via, config_key, token) VALUES('.env.example','src/pay.ts','лексика','STRIPE_KEY','STRIPE_KEY')")
    const rows = readConfigEdges(db, 'src/pay.ts')
    expect(rows.map((r) => r.configFile)).toEqual(['.env.example'])
    expect(JSON.stringify(rows)).not.toContain(SECRET)
    db.close()
  })

  it('правило среды с секретом не сохраняется, а старое — удаляется при чтении', () => {
    const db = openDb(':memory:')
    const stored = storeRules(db, [
      { pattern: 'stripe\\.charges', configKey: 'STRIPE_KEY', configFile: '.env', requires: SECRET, what: 'x', model: 'm' },
      { pattern: 'fetch\\(', configKey: 'API_BASE', configFile: '.env.example', requires: 'https://api.example.com', what: 'y', model: 'm' },
    ])
    expect(stored).toBe(1)
    db.run(
      "INSERT INTO contract_rule(pattern, config_key, config_file, requires, what, model, created_at) VALUES('old','TOKEN','config.json',?,'w','m','2026-01-01')",
      SECRET,
    )
    const rules = readRules(db)
    expect(rules.map((r) => r.configKey)).toEqual(['API_BASE'])
    expect(JSON.stringify(rules)).not.toContain(SECRET)
    db.close()
  })

  it('storeConfigEdges: связь от носителя секретов не записывается', () => {
    const db = openDb(':memory:')
    storeConfigEdges(db, [{ configFile: '.env.local', codeFile: 'src/a.ts', via: 'лексика', key: 'K', token: SECRET }])
    expect(readConfigEdges(db, 'src/a.ts')).toEqual([])
    db.close()
  })
})
