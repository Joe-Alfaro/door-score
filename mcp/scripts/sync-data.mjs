// Copies the pipeline output into mcp/data so the build (and Docker image) has the data baked in.
// Source can be overridden with DOORS_SOURCE; skipped gracefully if the source is absent but a
// local copy already exists (e.g. inside a Docker build where ../data is not in the context).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = resolve(root, process.env.DOORS_SOURCE ?? '../data/out/doors.json')
const target = resolve(root, 'data/doors.json')

mkdirSync(dirname(target), { recursive: true })

if (existsSync(source)) {
  copyFileSync(source, target)
  const bytes = statSync(target).size
  console.log(`sync-data: copied ${source} -> ${target} (${bytes} bytes)`)
} else if (existsSync(target)) {
  console.log(`sync-data: source ${source} not found; keeping existing ${target}`)
} else {
  console.error(`sync-data: neither ${source} nor ${target} exists`)
  process.exit(1)
}
