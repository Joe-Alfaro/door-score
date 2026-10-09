import type { DoorFeature, TagCount } from '../types'

export interface DoorStats {
  count: number
  medianScore: number
  newMovers: number
  absenteeOwners: number
  withImagery: number
  providerOnSite: number
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

/** True when the door has a Street View frame the vision model could actually read. */
export function hasUsableImagery(door: DoorFeature): boolean {
  return door.properties.vision?.signals?.image_usable === true
}

export function computeStats(doors: DoorFeature[]): DoorStats {
  const hasTag = (door: DoorFeature, tag: string) => door.properties.tags.includes(tag)
  return {
    count: doors.length,
    medianScore: median(doors.map((door) => door.properties.door_score)),
    newMovers: doors.filter((door) => hasTag(door, 'new mover')).length,
    absenteeOwners: doors.filter((door) => hasTag(door, 'absentee owner')).length,
    withImagery: doors.filter(hasUsableImagery).length,
    providerOnSite: doors.filter((door) => hasTag(door, 'provider on site')).length,
  }
}

/** Distinct tags across the loaded doors, most common first (ties alphabetical). */
export function tagCounts(doors: DoorFeature[]): TagCount[] {
  const counts = doors.reduce<Map<string, number>>((acc, door) => {
    door.properties.tags.forEach((tag) => acc.set(tag, (acc.get(tag) ?? 0) + 1))
    return acc
  }, new Map())
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
