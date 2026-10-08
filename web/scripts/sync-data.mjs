// Copies the pipeline's GeoJSON outputs into public/data so Vite serves them
// at /data/*.geojson in both dev and the production build.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const repoRoot = resolve(webRoot, '..')
const outDir = resolve(webRoot, 'public', 'data')

// MapLibre 6 resolves its web worker relative to its own module URL, which Vite rewrites,
// so the worker must be served as a plain static file and pointed at explicitly (see main.tsx).
const maplibreDist = resolve(webRoot, 'node_modules', 'maplibre-gl', 'dist')
const maplibreOut = resolve(webRoot, 'public', 'maplibre')
mkdirSync(maplibreOut, { recursive: true })
;['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'].forEach((name) => {
  const from = resolve(maplibreDist, name)
  if (existsSync(from)) copyFileSync(from, resolve(maplibreOut, name))
})

const files = [
  { from: resolve(repoRoot, 'data', 'out', 'doors.geojson'), to: resolve(outDir, 'doors.geojson') },
  { from: resolve(repoRoot, 'data', 'territory.geojson'), to: resolve(outDir, 'territory.geojson') },
]

mkdirSync(outDir, { recursive: true })

const missing = files.filter((file) => !existsSync(file.from))
if (missing.length > 0) {
  // Allow the build to continue if the data has already been synced (e.g. on Railway,
  // where ../data may not exist); fail only if nothing is available to serve.
  const stillMissing = missing.filter((file) => !existsSync(file.to))
  if (stillMissing.length > 0) {
    stillMissing.forEach((file) => console.error(`sync-data: missing source ${file.from}`))
    process.exit(1)
  }
  missing.forEach((file) => console.warn(`sync-data: source missing, keeping existing ${file.to}`))
}

files
  .filter((file) => existsSync(file.from))
  .forEach((file) => {
    copyFileSync(file.from, file.to)
    console.log(`sync-data: ${file.from} -> ${file.to}`)
  })
