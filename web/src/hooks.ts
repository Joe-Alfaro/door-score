import { useEffect, useState } from 'react'
import type { DoorCollection, TerritoryCollection } from './types'

interface LoadedData {
  doors: DoorCollection
  territory: TerritoryCollection
}

interface DataState {
  data: LoadedData | null
  error: string | null
}

function isFeatureCollection(value: unknown): value is { type: 'FeatureCollection'; features: unknown[] } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.type === 'FeatureCollection' && Array.isArray(record.features)
}

async function fetchCollection<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const json: unknown = await response.json()
  if (!isFeatureCollection(json)) throw new Error(`${url}: not a GeoJSON FeatureCollection`)
  // The pipeline owns the property schema; the runtime check above guards the envelope only.
  return json as T
}

export function useDoorData(): DataState {
  const [state, setState] = useState<DataState>({ data: null, error: null })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchCollection<DoorCollection>('/data/doors.geojson'),
      fetchCollection<TerritoryCollection>('/data/territory.geojson'),
    ])
      .then(([doors, territory]) => {
        if (!cancelled) setState({ data: { doors, territory }, error: null })
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        const message = reason instanceof Error ? reason.message : 'Failed to load data'
        setState({ data: null, error: message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
