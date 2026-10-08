import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Door } from './types.js'

export const DEFAULT_DOORS_PATH = './data/doors.json'

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

export function loadDoors(path: string = process.env.DOORS_PATH ?? DEFAULT_DOORS_PATH): Door[] {
  const absolute = resolve(path)
  const parsed: unknown = JSON.parse(readFileSync(absolute, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`${absolute}: expected a JSON array of doors`)
  }
  const doors = parsed.filter(isDoor)
  if (doors.length !== parsed.length) {
    console.warn(`loadDoors: skipped ${parsed.length - doors.length} malformed records`)
  }
  // The pipeline sorts by door_score desc already; re-sort defensively so rank/order logic holds.
  return [...doors].sort((a, b) => b.door_score - a.door_score || a.rank - b.rank)
}
