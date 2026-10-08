import type { LngLatBoundsLike } from 'maplibre-gl'
import type { TerritoryCollection } from '../types'

type Position = number[]

function flattenPositions(coordinates: unknown): Position[] {
  if (!Array.isArray(coordinates)) return []
  const first: unknown = coordinates[0]
  if (typeof first === 'number') return [coordinates as Position]
  return coordinates.flatMap((inner: unknown) => flattenPositions(inner))
}

/** Bounding box of every ring in the territory, as [[west, south], [east, north]]. */
export function territoryBounds(territory: TerritoryCollection): LngLatBoundsLike | undefined {
  const positions = territory.features.flatMap((feature) => flattenPositions(feature.geometry.coordinates))
  if (positions.length === 0) return undefined
  const lngs = positions.map((position) => position[0] ?? 0)
  const lats = positions.map((position) => position[1] ?? 0)
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}
