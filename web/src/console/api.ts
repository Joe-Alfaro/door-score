import type {
  DoorDetail,
  DoorsPage,
  DoorsQuery,
  EvalResponse,
  Health,
  LedgerResponse,
  McpToolsResponse,
  RoutePlan,
  RouteRequest,
  RunRecord,
  RunRequestBody,
  RunsResponse,
  RunWithLog,
  SourcesResponse,
  StagesResponse,
  Status,
  StreamEvent,
  TagCount,
} from './types'

export const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')
import { getConsoleToken } from './token'

/** Backend errors (400/401/403/409/502) carry a human-readable `detail`; surface it as the message. */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text()
  try {
    const body: unknown = JSON.parse(text)
    if (isRecord(body) && body.detail !== undefined) {
      const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
      return new ApiError(response.status, detail)
    }
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return new ApiError(response.status, text || `${response.status} ${response.statusText}`)
}

/** Dataset-scoped endpoints read the custom territory named in the page URL (?territory=<id>), if any. */
export function activeTerritoryId(): string | null {
  return new URLSearchParams(window.location.search).get('territory')
}

const TERRITORY_SCOPED = ['/api/status', '/api/doors', '/api/tags']

function withTerritory(path: string): string {
  const tid = activeTerritoryId()
  if (!tid || !TERRITORY_SCOPED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))) return path
  return `${path}${path.includes('?') ? '&' : '?'}territory=${encodeURIComponent(tid)}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${withTerritory(path)}`, init)
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

function mutationHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getConsoleToken()
  if (token) headers['X-Console-Token'] = token
  return headers
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify(body) })
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

export function getHealth(): Promise<Health> {
  return request<Health>('/api/health')
}

export function getStatus(): Promise<Status> {
  return request<Status>('/api/status')
}

export function getDoors(params: DoorsQuery = {}): Promise<DoorsPage> {
  return request<DoorsPage>(`/api/doors${queryString({ ...params })}`)
}

export function getDoor(doorId: string): Promise<DoorDetail> {
  return request<DoorDetail>(`/api/doors/${encodeURIComponent(doorId)}`)
}

function isTagCount(value: unknown): value is TagCount {
  return isRecord(value) && typeof value.tag === 'string' && typeof value.count === 'number'
}

/** Accepts both `{tags:[{tag,count}]}` and a plain `{tag: count}` map. */
export function normalizeTags(body: unknown): TagCount[] {
  if (!isRecord(body)) return []
  if (Array.isArray(body.tags)) return body.tags.filter(isTagCount)
  const source = isRecord(body.tags) ? body.tags : body
  return Object.entries(source)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export async function getTags(): Promise<TagCount[]> {
  return normalizeTags(await request<unknown>('/api/tags'))
}

export function getSources(): Promise<SourcesResponse> {
  return request<SourcesResponse>('/api/sources')
}

export function getEval(): Promise<EvalResponse> {
  return request<EvalResponse>('/api/eval')
}

/** `image` is a path like `images/<door_id>.jpg`; the endpoint wants the basename. */
export function evalImageUrl(image: string): string {
  const name = image.split('/').pop() ?? image
  return `${API_BASE}/api/eval/images/${encodeURIComponent(name)}`
}

export function getLedger(limit: number): Promise<LedgerResponse> {
  return request<LedgerResponse>(`/api/ledger${queryString({ limit })}`)
}

export function getStages(): Promise<StagesResponse> {
  return request<StagesResponse>('/api/stages')
}

export function runStage(stageId: string, body: RunRequestBody): Promise<RunRecord> {
  return post<RunRecord>(`/api/run/${encodeURIComponent(stageId)}`, body)
}

export function getRuns(): Promise<RunsResponse> {
  return request<RunsResponse>('/api/runs')
}

export function getRun(runId: string, tail = 400): Promise<RunWithLog> {
  return request<RunWithLog>(`/api/runs/${encodeURIComponent(runId)}${queryString({ tail })}`)
}

export function runStreamUrl(runId: string): string {
  return `${API_BASE}/api/runs/${encodeURIComponent(runId)}/stream`
}

export function cancelRun(runId: string): Promise<RunRecord> {
  return post<RunRecord>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {})
}

export function parseStreamEvent(raw: string): StreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (typeof parsed.line === 'string') return { line: parsed.line }
    if (parsed.done === true) {
      return {
        done: true,
        status: typeof parsed.status === 'string' ? parsed.status : 'unknown',
        exit_code: typeof parsed.exit_code === 'number' ? parsed.exit_code : null,
      }
    }
    return null
  } catch {
    return null
  }
}

function isRoutePlan(value: unknown): value is RoutePlan {
  return isRecord(value) && Array.isArray(value.stops) && isRecord(value.totals)
}

/** The backend may return the MCP plan bare or wrapped as `{arguments, plan}`; accept both. */
export async function planRoute(body: RouteRequest): Promise<RoutePlan> {
  const response = await post<unknown>('/api/route', body)
  if (isRoutePlan(response)) return response
  if (isRecord(response) && isRoutePlan(response.plan)) return response.plan
  throw new ApiError(502, 'Route planner returned an unexpected response shape')
}

export function getMcpTools(): Promise<McpToolsResponse> {
  return request<McpToolsResponse>('/api/mcp/tools')
}

/** Street View frames are fetched at view time through the API proxy; nothing is stored by this project. */
export function streetViewUrl(doorId: string): string {
  return `${API_BASE}/api/streetview/${encodeURIComponent(doorId)}.jpg`
}
