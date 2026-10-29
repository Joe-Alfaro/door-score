import { useEffect, useState } from 'react'
import type { DataUrls, DoorCollection, TerritoryCollection } from './types'

export interface LoadedData {
  doors: DoorCollection
  territory: TerritoryCollection
}

interface DataState {
  data: LoadedData | null
  error: string | null
  loading: boolean
}

/** Nothing is preloaded: the map starts empty until the user draws (or opens a shared) area. */
export const EMPTY_DATA: LoadedData = {
  doors: { type: 'FeatureCollection', features: [] },
  territory: { type: 'FeatureCollection', features: [] },
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

/**
 * Loads doors + territory for the active user-drawn area. With no area (`urls` null) the map is empty.
 * Previously loaded data stays in place while a new source loads so the map does not unmount.
 */
export function useDoorData(urls: DataUrls | null): DataState {
  const [state, setState] = useState<DataState>({ data: urls ? null : EMPTY_DATA, error: null, loading: urls !== null })
  const doorsUrl = urls?.doors ?? null
  const territoryUrl = urls?.territory ?? null

  useEffect(() => {
    if (!doorsUrl || !territoryUrl) {
      setState({ data: EMPTY_DATA, error: null, loading: false })
      return
    }
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
