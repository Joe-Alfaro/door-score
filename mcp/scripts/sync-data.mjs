// Optional: copy a local pipeline run (e.g. on your own polygon) into mcp/data so DOORS_PATH can serve it.
// No data ships with the server; by default it loads user-drawn areas on demand (POST /mcp?territory=<id>).
// Source can be overridden with DOORS_SOURCE. A missing source is not an error.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = resolve(root, process.env.DOORS_SOURCE ?? '../data/out/doors.json')
const target = resolve(root, 'data/doors.json')

if (existsSync(source)) {
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  console.log(`sync-data: copied ${source} -> ${target} (${statSync(target).size} bytes)`)
} else {
  console.log(`sync-data: no local pipeline output at ${source}; the server will load drawn areas on demand`)
}
