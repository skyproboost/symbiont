/**
 * Внешнее заземление /sym-elevate: под обнаруженную потребность найти
 * ПРОВЕРЕННЫЙ внешний подход (официальные скиллы/плагины/паттерны/алгоритмы),
 * отфильтровать до того, что НУЖНО именно здесь (в какой форме, в сочетании),
 * и синтезировать с ВНУТРЕННИМ проекта — его зависимостями, скриптами, env.
 *
 * Безопасность (гард владельца): читаем только ИМЕНА env-ключей (.env.example,
 * ссылки process.env.X в коде) — НИКОГДА значения. Ни один секрет не покидает
 * машину и не попадает в промпт.
 *
 * Опционально и дорого (веб-инструменты, --ground). Офлайн/сбой → деградация
 * на априори модели, не падение.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { walkFiles, codeFiles } from '../miner/walk'

export interface Internals {
  deps: string[]
  scripts: string[]
  envKeys: string[]
  repoTools: string[]
}

const ENV_REF = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]{2,})/g

/** Внутреннее проекта для синтеза. Значения секретов НЕ читаются — только имена. */
export function gatherInternals(projectRoot: string): Internals {
  const deps: string[] = []
  const scripts: string[] = []
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    deps.push(...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}))
    scripts.push(...Object.keys(pkg.scripts ?? {}))
  } catch {
    /* нет package.json — не веб/не-node проект, это норма */
  }

  // Имена env-ключей: из .env.example (шаблон без значений) + ссылок в коде
  const envKeys = new Set<string>()
  for (const name of ['.env.example', '.env.sample', '.env.template']) {
    try {
      for (const line of readFileSync(join(projectRoot, name), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z][A-Z0-9_]{2,})\s*=/)
        if (m) envKeys.add(m[1])
      }
    } catch {
      /* нет шаблона */
    }
  }
  // Ссылки process.env.X в коде (имена, не значения) — бюджетно, первые файлы
  try {
    const files = codeFiles(walkFiles(projectRoot)).slice(0, 400)
    for (const f of files) {
      let content = ''
      try {
        content = readFileSync(f.path, 'utf8')
      } catch {
        continue
      }
      for (const m of content.matchAll(ENV_REF)) envKeys.add(m[1])
    }
  } catch {
    /* обход не удался — не критично */
  }

  // Инструменты репозитория (скрипты в scripts/) — плейбук может их использовать
  const repoTools: string[] = []
  try {
    const scriptFiles = walkFiles(join(projectRoot, 'scripts'))
      .filter((f) => ['.mjs', '.ts', '.js', '.sh', '.py'].includes(f.ext))
      .map((f) => f.path.split(/[\\/]/).pop() as string)
    repoTools.push(...new Set(scriptFiles))
  } catch {
    /* нет scripts/ */
  }

  return {
    deps: [...new Set(deps)].slice(0, 60),
    scripts: [...new Set(scripts)].slice(0, 40),
    envKeys: [...envKeys].slice(0, 40),
    repoTools: repoTools.slice(0, 40),
  }
}

export function buildGroundPrompt(needs: string[], internals: Internals): string {
  return [
    'Ты усиливаешь предложения по возвышению проекта, заземляя их на ПРОВЕРЕННЫЕ внешние подходы.',
    'Для каждой значимой потребности проекта: найди официальный/признанный подход (скилл, плагин, паттерн, алгоритм, архитектуру), но возьми ТОЛЬКО то, что нужно ИМЕННО здесь — в подходящей форме, возможно в сочетании. НЕ тащи всё подряд (анти-карго-культ): подгоняй под конвенции и стек этого проекта.',
    'Синтезируй с ВНУТРЕННИМ проекта: если у проекта уже есть подходящая зависимость, скрипт, env-ключ или инструмент — предложи использовать именно его, а не вводить новый.',
    'Каждое утверждение о внешнем подходе подкрепляй источником (ссылкой). Если не уверен или нет данных — так и скажи, не выдумывай.',
    '',
    '## Потребности проекта (обнаруженные оси/предложения)',
    ...needs.map((n) => `- ${n}`),
    '',
    '## Внутреннее проекта (для синтеза; значения секретов НЕ приводятся)',
    `- зависимости: ${internals.deps.join(', ') || '—'}`,
    `- npm-скрипты: ${internals.scripts.join(', ') || '—'}`,
    `- env-ключи (имена): ${internals.envKeys.join(', ') || '—'}`,
    `- инструменты репозитория (scripts/): ${internals.repoTools.join(', ') || '—'}`,
    '',
    '## Что вернуть',
    'Для каждой потребности, где внешний подход реально помогает: «потребность → проверенный подход (источник) → что именно взять и в какой форме → как синтезировать с внутренним проекта». Кратко, по делу, с реальными ссылками. Если заземление ничего не добавляет — скажи прямо.',
  ].join('\n')
}

export type ToolCaller = (prompt: string) => { text: string; model: string } | null

export interface GroundResult {
  model: string | null
  text: string
  internals: Internals
}

export function runGround(projectRoot: string, needs: string[], caller: ToolCaller): GroundResult {
  const internals = gatherInternals(projectRoot)
  if (needs.length === 0) return { model: null, text: '', internals }
  const res = caller(buildGroundPrompt(needs, internals))
  return { model: res?.model ?? null, text: res?.text ?? '', internals }
}
