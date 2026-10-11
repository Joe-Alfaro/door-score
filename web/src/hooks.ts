import { useEffect, useState } from 'react'
import type { DataUrls, DoorCollection, TerritoryCollection } from './types'

interface LoadedData {
  doors: DoorCollection
  territory: TerritoryCollection
}

interface DataState {
  data: LoadedData | null
  error: string | null
  loading: boolean
}

/** The pipeline's default output, synced into public/data by scripts/sync-data.mjs. */
export const DEFAULT_DATA_URLS: DataUrls = { doors: '/data/doors.geojson', territory: '/data/territory.geojson' }

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

/**
 * Loads doors + territory from `urls` (default data unless a custom territory is active).
 * Previously loaded data stays in place while a new source loads so the map does not unmount.
 */
export function useDoorData(urls: DataUrls = DEFAULT_DATA_URLS): DataState {
  const [state, setState] = useState<DataState>({ data: null, error: null, loading: true })
  const { doors: doorsUrl, territory: territoryUrl } = urls

  useEffect(() => {
    let cancelled = false
    setState((previous) => ({ ...previous, error: null, loading: true }))
    Promise.all([fetchCollection<DoorCollection>(doorsUrl), fetchCollection<TerritoryCollection>(territoryUrl)])
      .then(([doors, territory]) => {
        if (!cancelled) setState({ data: { doors, territory }, error: null, loading: false })
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        const message = reason instanceof Error ? reason.message : 'Failed to load data'
        setState((previous) => ({ data: previous.data, error: message, loading: false }))
      })
    return () => {
      cancelled = true
    }
  }, [doorsUrl, territoryUrl])

  return state
}
