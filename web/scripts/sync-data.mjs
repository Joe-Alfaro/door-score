// Copies the MapLibre worker into public/maplibre so Vite serves it as a static file.
// No door data is bundled: the map starts empty and loads a user-drawn area from the console API
// (POST /api/territory, then /api/territory/<id>/doors.geojson). Street View frames are fetched at
// view time through the console API proxy (/api/streetview/<door_id>.jpg).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')

// MapLibre 6 resolves its web worker relative to its own module URL, which Vite rewrites,
// so the worker must be served as a plain static file and pointed at explicitly (see main.tsx).
const maplibreDist = resolve(webRoot, 'node_modules', 'maplibre-gl', 'dist')
const maplibreOut = resolve(webRoot, 'public', 'maplibre')
mkdirSync(maplibreOut, { recursive: true })
;['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'].forEach((name) => {
  const from = resolve(maplibreDist, name)
  if (existsSync(from)) copyFileSync(from, resolve(maplibreOut, name))
})
