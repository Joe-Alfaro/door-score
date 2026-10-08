import type { DoorFeature } from '../types'

export interface DoorStats {
  count: number
  medianScore: number
  newMovers: number
  absenteeOwners: number
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid] ?? 0
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[mid - 1] ?? upper
  return (lower + upper) / 2
}

export function computeStats(doors: DoorFeature[]): DoorStats {
  const hasTag = (door: DoorFeature, tag: string) => door.properties.tags.includes(tag)
  return {
    count: doors.length,
    medianScore: median(doors.map((door) => door.properties.door_score)),
    newMovers: doors.filter((door) => hasTag(door, 'new mover')).length,
    absenteeOwners: doors.filter((door) => hasTag(door, 'absentee owner')).length,
  }
}
