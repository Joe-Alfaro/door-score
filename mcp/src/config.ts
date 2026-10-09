export const DEFAULT_PHOTO_BASE_URL = 'https://web-production-39b2a.up.railway.app'

/** Base URL of the companion web app that serves street-view images and the door map. */
export function photoBaseUrl(): string {
  const raw = process.env.PHOTO_BASE_URL?.trim()
  const base = raw && raw.length > 0 ? raw : DEFAULT_PHOTO_BASE_URL
  return base.replace(/\/+$/, '')
}

export function streetViewImageUrl(doorId: string): string {
  return `${photoBaseUrl()}/img/streetview/${encodeURIComponent(doorId)}.jpg`
}

export function explainUrl(doorId: string): string {
  return `${photoBaseUrl()}/?door=${encodeURIComponent(doorId)}`
}
