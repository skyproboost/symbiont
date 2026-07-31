import { join } from 'node:path'
import { buildStatusReport } from './reports'
import { resolveDataRoot, migrateLegacyPassports } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'

const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
console.log(buildStatusReport(join(res.root, slugOf(process.cwd()))))
