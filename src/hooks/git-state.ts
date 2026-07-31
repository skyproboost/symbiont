/**
 * Живое git-состояние проекта для блока «Состояние» в сводке.
 * Fail-open: нет git / не репозиторий / таймаут — возвращаем null, сводка без блока.
 */
import { spawnSync } from 'node:child_process'
import { t } from '../core/i18n'

export interface GitState {
  branch: string
  dirtyCount: number
  dirtyTop: string[]
  lastCommit: string | null
}

function git(cwd: string, args: string[]): string | null {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true })
    if (r.status !== 0 || typeof r.stdout !== 'string') return null
    return r.stdout.trim()
  } catch {
    return null
  }
}

export function gitState(cwd: string): GitState | null {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) return null
  const porcelain = git(cwd, ['status', '--porcelain']) ?? ''
  const dirty = porcelain.split('\n').filter((l) => l.trim().length > 0)
  return {
    branch,
    dirtyCount: dirty.length,
    dirtyTop: dirty.slice(0, 5).map((l) => l.slice(3).trim()),
    lastCommit: git(cwd, ['log', '-1', '--format=%s (%cr)']),
  }
}

/**
 * Санитизация недоверенного текста из репозитория перед вклейкой в контекст
 * (находка /sym-elevate: commit-месседж/пути — единственный untrusted→context
 * канал). Первая строка, жёсткий лимит, как данные в бэктиках, переводы строк
 * убраны — чтобы чужой текст не «притворялся» инструкциями паспорта.
 */
function asData(s: string, limit = 120): string {
  const firstLine = s.split(/[\r\n]/)[0].replace(/`/g, "'").trim()
  const cut = firstLine.slice(0, limit)
  return '`' + cut + (firstLine.length > limit ? '…' : '') + '`'
}

export function renderGitBlock(g: GitState, reconciledDirty: number): string {
  const lines = [t('## Состояние', '## State'), '']
  lines.push(
    `- ${t('ветка', 'branch')}: ${g.branch} · ${t('незакоммичено', 'uncommitted')}: ${g.dirtyCount}${
      g.dirtyCount > 0 ? ` (${g.dirtyTop.map((f) => asData(f, 80)).join(', ')}${g.dirtyCount > 5 ? ', …' : ''})` : ''
    }`,
  )
  if (g.lastCommit) lines.push(`- ${t('последний коммит', 'last commit')}: ${asData(g.lastCommit)}`)
  if (reconciledDirty > 0) {
    lines.push(
      t(
        `- прошлая сессия (${reconciledDirty} шт.) оборвалась без завершения — обрыв учтён`,
        `- ${reconciledDirty} previous session(s) died without finishing — the break has been accounted for`,
      ),
    )
  }
  return lines.join('\n')
}
