export const DEFAULT_PHOTO_BASE_URL = 'https://web-production-39b2a.up.railway.app'

/** Base URL of the companion web app that serves street-view images and the door map. */
export function photoBaseUrl(): string {
  const raw = process.env.PHOTO_BASE_URL?.trim()
  const base = raw && raw.length > 0 ? raw : DEFAULT_PHOTO_BASE_URL
  return base.replace(/\/+$/, '')
}

export function apiBaseUrl(): string {
  return (process.env.API_BASE_URL ?? 'https://api-production-37c4.up.railway.app').replace(/\/$/, '')
}

export function streetViewImageUrl(doorId: string): string {
  return `${apiBaseUrl()}/api/streetview/${encodeURIComponent(doorId)}.jpg`
}

export function explainUrl(doorId: string, territoryId?: string): string {
  const territory = territoryId ? `territory=${encodeURIComponent(territoryId)}&` : ''
  return `${photoBaseUrl()}/?${territory}door=${encodeURIComponent(doorId)}`
}
