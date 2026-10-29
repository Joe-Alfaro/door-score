import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { apiBaseUrl } from './config.js'
import type { Door } from './types.js'

function isDoor(value: unknown): value is Door {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.door_id === 'string' &&
    typeof record.address === 'string' &&
    typeof record.door_score === 'number' &&
    Array.isArray(record.tags) &&
    Array.isArray(record.signals)
  )
}

function toDoors(parsed: unknown, source: string): Door[] {
  if (!Array.isArray(parsed)) {
    throw new Error(`${source}: expected a JSON array of doors`)
  }
  const doors = parsed.filter(isDoor)
  if (doors.length !== parsed.length) {
    console.warn(`loadDoors: skipped ${parsed.length - doors.length} malformed records`)
  }
  // The pipeline sorts by door_score desc already; re-sort defensively so rank/order logic holds.
  return [...doors].sort((a, b) => b.door_score - a.door_score || a.rank - b.rank)
}

/**
 * Optional local dataset (DOORS_PATH), e.g. a pipeline run on your own polygon. No data ships with
 * the server: without DOORS_PATH it starts empty and serves user-drawn areas via ?territory=<id>.
 */
export function loadDoors(path: string | undefined = process.env.DOORS_PATH): Door[] {
  if (!path) return []
  const absolute = resolve(path)
  if (!existsSync(absolute)) {
    console.warn(`loadDoors: ${absolute} not found; starting with no local doors`)
    return []
  }
  return toDoors(JSON.parse(readFileSync(absolute, 'utf8')), absolute)
}

const TERRITORY_ID = /^[A-Za-z0-9_-]{1,64}$/
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; doors: Door[] }>()

/** Doors for an area the user drew in the map, fetched on demand from the console API. */
export async function fetchTerritoryDoors(territoryId: string): Promise<Door[]> {
  if (!TERRITORY_ID.test(territoryId)) throw new Error('invalid territory id')
  const hit = cache.get(territoryId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.doors
  const url = `${apiBaseUrl()}/api/territory/${encodeURIComponent(territoryId)}/doors.json`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`territory ${territoryId}: HTTP ${response.status} (not found or not scored yet)`)
  const doors = toDoors(await response.json(), url)
  cache.set(territoryId, { at: Date.now(), doors })
  return doors
}
