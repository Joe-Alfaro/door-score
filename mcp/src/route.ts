import { walkMinutes } from './geo.js'
import { primaryTalkingPoint } from './talking-points.js'
import type { DoorWithCoords, LatLng } from './types.js'

export const VISIT_MINUTES = 6
const MAPS_WAYPOINT_CAP = 10

export interface RouteStop {
  order: number
  door_id: string
  address: string
  door_score: number
  lat: number
  lng: number
  walk_minutes_from_previous: number
  arrive_minute: number
  talking_point: string
}

export interface RouteTotals {
  doors: number
  total_minutes: number
  walking_minutes: number
  total_score: number
}

export interface RoutePlan {
  start: LatLng
  stops: RouteStop[]
  totals: RouteTotals
  google_maps_url: string
}

interface GreedyState {
  position: LatLng
  elapsed: number
  chosen: DoorWithCoords[]
  remaining: DoorWithCoords[]
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Greedy selection: at each step take the door with the best score per minute spent
 * (walk + visit) that still fits in the budget. Stops when nothing fits or max_doors is hit.
 */
function greedySelect(start: LatLng, candidates: DoorWithCoords[], budgetMinutes: number, maxDoors: number): DoorWithCoords[] {
  const initial: GreedyState = { position: start, elapsed: 0, chosen: [], remaining: candidates }
  const steps = Array.from({ length: Math.min(maxDoors, candidates.length) })
  const final = steps.reduce<GreedyState>((state) => {
    if (state.remaining.length === 0) return state
    const scored = state.remaining
      .map((door) => {
        const travel = walkMinutes(state.position, door)
        return { door, travel, cost: travel + VISIT_MINUTES, ratio: door.door_score / (travel + VISIT_MINUTES) }
      })
      .filter((entry) => state.elapsed + entry.cost <= budgetMinutes)
      .sort((a, b) => b.ratio - a.ratio)
    const best = scored[0]
    if (!best) return { ...state, remaining: [] }
    return {
      position: best.door,
      elapsed: state.elapsed + best.cost,
      chosen: [...state.chosen, best.door],
      remaining: state.remaining.filter((door) => door.door_id !== best.door.door_id),
    }
  }, initial)
  return final.chosen
}

/**
 * 2-opt with a fixed origin (the start point) and an open end. Reversing stops[i..j]
 * only changes the two edges around the segment, so each candidate is evaluated in O(1).
 */
function twoOpt(start: LatLng, order: DoorWithCoords[]): DoorWithCoords[] {
  const at = (current: DoorWithCoords[], index: number): LatLng => (index < 0 ? start : (current[index] ?? start))

  const improve = (current: DoorWithCoords[]): DoorWithCoords[] => {
    const last = current.length - 1
    const moves = current.flatMap((_, i) =>
      current.slice(i + 1).map((__, offset) => {
        const j = i + 1 + offset
        const before = at(current, i - 1)
        const removed = walkMinutes(before, at(current, i)) + (j < last ? walkMinutes(at(current, j), at(current, j + 1)) : 0)
        const added = walkMinutes(before, at(current, j)) + (j < last ? walkMinutes(at(current, i), at(current, j + 1)) : 0)
        return { i, j, gain: removed - added }
      }),
    )
    const best = moves.reduce((top, move) => (move.gain > top.gain ? move : top), { i: 0, j: 0, gain: 0 })
    if (best.gain <= 1e-9) return current
    return improve([...current.slice(0, best.i), ...current.slice(best.i, best.j + 1).reverse(), ...current.slice(best.j + 1)])
  }
  return order.length < 3 ? order : improve(order)
}

function buildStops(start: LatLng, order: DoorWithCoords[]): RouteStop[] {
  return order.reduce<RouteStop[]>((stops, door, index) => {
    const previous = stops[index - 1]
    const from: LatLng = previous ? { lat: previous.lat, lng: previous.lng } : start
    const walk = walkMinutes(from, door)
    const arrive = (previous ? previous.arrive_minute + VISIT_MINUTES : 0) + walk
    return [
      ...stops,
      {
        order: index + 1,
        door_id: door.door_id,
        address: door.address,
        door_score: door.door_score,
        lat: door.lat,
        lng: door.lng,
        walk_minutes_from_previous: round(walk),
        arrive_minute: round(arrive),
        talking_point: primaryTalkingPoint(door),
      },
    ]
  }, [])
}

function mapsUrl(stops: RouteStop[]): string {
  const points = stops.slice(0, MAPS_WAYPOINT_CAP).map((stop) => `${stop.lat},${stop.lng}`)
  return `https://www.google.com/maps/dir/${points.join('/')}`
}

export function planRoute(start: LatLng, candidates: DoorWithCoords[], budgetMinutes: number, maxDoors: number): RoutePlan {
  const chosen = greedySelect(start, candidates, budgetMinutes, maxDoors)
  const ordered = twoOpt(start, chosen)
  const stops = buildStops(start, ordered)
  const walking = stops.reduce((sum, stop) => sum + stop.walk_minutes_from_previous, 0)
  return {
    start,
    stops,
    totals: {
      doors: stops.length,
      total_minutes: round(walking + stops.length * VISIT_MINUTES),
      walking_minutes: round(walking),
      total_score: stops.reduce((sum, stop) => sum + stop.door_score, 0),
    },
    google_maps_url: mapsUrl(stops),
  }
}
