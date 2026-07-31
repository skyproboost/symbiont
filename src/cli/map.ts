import { join } from 'node:path'
import { buildMapReport } from './reports'
import { resolveDataRoot, migrateLegacyPassports } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'

const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const zone = process.argv[2]?.trim() || undefined
console.log(buildMapReport(join(res.root, slugOf(process.cwd())), zone))
