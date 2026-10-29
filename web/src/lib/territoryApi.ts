import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { getConsoleToken } from '../console/token'
import type { DataUrls, TerritoryInput, TerritoryRecord, TerritoryStartResponse } from '../types'

/**
 * Client for the console API's custom-territory endpoints:
 *   POST /api/territory                               -> 201 { territory_id, run_id, status }
 *   GET  /api/territory/{id}                          -> { status, log_tail, report?, ... }
 *   GET  /api/territory/{id}/doors.geojson            -> FeatureCollection of scored doors
 *   GET  /api/territory/{id}/territory.geojson        -> FeatureCollection with the polygon
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

const POLL_INTERVAL_MS = 3000

export class TerritoryApiError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'TerritoryApiError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function toError(response: Response): Promise<TerritoryApiError> {
  if (response.status === 409) {
    return new TerritoryApiError(409, 'The scorer is busy with another territory; try again in a minute.')
  }
  const text = await response.text()
  try {
    const body: unknown = JSON.parse(text)
    if (isRecord(body) && body.detail !== undefined) {
      const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
      return new TerritoryApiError(response.status, detail)
    }
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return new TerritoryApiError(response.status, text || `${response.status} ${response.statusText}`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  if (!response.ok) throw await toError(response)
  return (await response.json()) as T
}

/** Starts a scoring run for the polygon; resolves with the ids once the backend has accepted it. */
export function startTerritory(geojson: TerritoryInput, name?: string): Promise<TerritoryStartResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // The backend may gate mutations behind the console token; send it when the operator has set one.
  const token = getConsoleToken()
  if (token) headers['X-Console-Token'] = token
  const body = name && name.trim() ? { geojson, name: name.trim() } : { geojson }
  return request<TerritoryStartResponse>('/api/territory', { method: 'POST', headers, body: JSON.stringify(body) })
}

export function getTerritory(territoryId: string): Promise<TerritoryRecord> {
  return request<TerritoryRecord>(`/api/territory/${encodeURIComponent(territoryId)}`)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Polling aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

/** Polls the territory every 3 s until its status leaves `running`; `onUpdate` sees every poll. */
export async function waitForTerritory(
  territoryId: string,
  onUpdate: (record: TerritoryRecord) => void,
  signal?: AbortSignal,
): Promise<TerritoryRecord> {
  const poll = async (): Promise<TerritoryRecord> => {
    const record = await getTerritory(territoryId)
    onUpdate(record)
    if (record.status !== 'running') return record
    await sleep(POLL_INTERVAL_MS, signal)
    return poll()
  }
  return poll()
}

export function territoryDataUrls(territoryId: string): DataUrls {
  const base = `${API_BASE}/api/territory/${encodeURIComponent(territoryId)}`
  return { doors: `${base}/doors.geojson`, territory: `${base}/territory.geojson` }
}

/** Absolute deep link that reloads this territory. */
export function territoryShareLink(territoryId: string): string {
  const url = new URL(window.location.origin)
  url.searchParams.set('territory', territoryId)
  return url.toString()
}

/* Input parsing */

function isPolygonGeometry(value: unknown): value is Polygon | MultiPolygon {
  return isRecord(value) && (value.type === 'Polygon' || value.type === 'MultiPolygon') && Array.isArray(value.coordinates)
}

function isPolygonFeature(value: unknown): value is Feature<Polygon | MultiPolygon> {
  return isRecord(value) && value.type === 'Feature' && isPolygonGeometry(value.geometry)
}

function isPolygonCollection(value: unknown): value is FeatureCollection<Polygon | MultiPolygon> {
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) return false
  return value.features.length > 0 && value.features.some(isPolygonFeature)
}

/**
 * Parses pasted or uploaded text into a Feature, FeatureCollection or bare Polygon/MultiPolygon.
 * Throws with a message suitable for showing in the panel.
 */
export function parseTerritoryInput(text: string): TerritoryInput {
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error('Paste or upload GeoJSON first.')
  const parsed: unknown = (() => {
    try {
      return JSON.parse(trimmed)
    } catch {
      throw new Error('That is not valid JSON.')
    }
  })()
  if (isPolygonGeometry(parsed) || isPolygonFeature(parsed) || isPolygonCollection(parsed)) return parsed
  throw new Error('Expected a GeoJSON Feature, FeatureCollection or Polygon/MultiPolygon geometry containing a polygon.')
}

/** Builds a closed Polygon feature from drawn vertices ([lng, lat] pairs). */
export function polygonFromRing(points: ReadonlyArray<readonly [number, number]>): Feature<Polygon> {
  const ring = points.map(([lng, lat]) => [lng, lat])
  const first = ring[0]
  const closed = first ? [...ring, first] : ring
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closed] } }
}
