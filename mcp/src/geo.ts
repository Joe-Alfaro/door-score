import type { LatLng } from './types.js'

const EARTH_RADIUS_KM = 6371
export const WALK_SPEED_KMH = 5

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function walkMinutes(a: LatLng, b: LatLng): number {
  return (haversineKm(a, b) / WALK_SPEED_KMH) * 60
}

/** Parses "lat,lng" (with optional whitespace). Returns undefined if not a coordinate pair. */
export function parseLatLng(input: string): LatLng | undefined {
  const match = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return undefined
  const lat = Number(match[1])
  const lng = Number(match[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined
  return { lat, lng }
}
