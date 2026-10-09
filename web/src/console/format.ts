export const DASH = '—'

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function usd(value: number | null | undefined, digits = 2): string {
  if (!isNumber(value)) return DASH
  return `$${value.toFixed(digits)}`
}

/** Formats a 0–1 fraction as a percentage. */
export function pct(value: number | null | undefined, digits = 0): string {
  if (!isNumber(value)) return DASH
  return `${(value * 100).toFixed(digits)}%`
}

/** Formats a value that is already in percent units (e.g. `82.8`). */
export function pctUnits(value: number | null | undefined, digits = 0): string {
  if (!isNumber(value)) return DASH
  return `${value.toFixed(digits)}%`
}

export function num(value: number | null | undefined, digits = 0): string {
  if (!isNumber(value)) return DASH
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function text(value: string | null | undefined): string {
  return value && value.length > 0 ? value : DASH
}

export function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return DASH
  return value ? 'yes' : 'no'
}

/** Epoch seconds (as the backend emits) to a local date-time string. */
export function fromEpoch(seconds: number | null | undefined): string {
  if (!isNumber(seconds)) return DASH
  return new Date(seconds * 1000).toLocaleString()
}

export function relativeTime(seconds: number | null | undefined): string {
  if (!isNumber(seconds)) return DASH
  const deltaSeconds = Math.max(0, Date.now() / 1000 - seconds)
  if (deltaSeconds < 60) return 'just now'
  if (deltaSeconds < 3600) return `${Math.round(deltaSeconds / 60)} min ago`
  if (deltaSeconds < 86400) return `${Math.round(deltaSeconds / 3600)} h ago`
  return `${Math.round(deltaSeconds / 86400)} d ago`
}

export function duration(startedSeconds: number | null | undefined, endedSeconds: number | null | undefined): string {
  if (!isNumber(startedSeconds)) return DASH
  const end = isNumber(endedSeconds) ? endedSeconds : Date.now() / 1000
  const total = Math.max(0, Math.round(end - startedSeconds))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

/** `provider_truck` → `provider truck`. */
export function humanize(name: string): string {
  return name.replace(/[_-]+/g, ' ')
}
