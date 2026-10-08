import type { ExpressionSpecification } from 'maplibre-gl'

/**
 * Sequential single-hue (blue) ramp, light -> dark, from the dataviz palette.
 * Starts at palette step 250 so the lightest dot still clears the light basemap (>= 2:1).
 */
export const SCORE_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, '#86b6ef'],
  [25, '#5598e7'],
  [50, '#2a78d6'],
  [75, '#1c5cab'],
  [100, '#0d366b'],
]

export const SCORE_COLOR_EXPRESSION: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['get', 'door_score'],
  ...SCORE_STOPS.flatMap(([score, color]) => [score, color]),
]

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const channel = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `rgb(${channel(ar, br)}, ${channel(ag, bg)}, ${channel(ab, bb)})`
}

/** JS mirror of SCORE_COLOR_EXPRESSION for use in the legend and side panel. */
export function scoreColor(score: number): string {
  const clamped = Math.max(0, Math.min(100, score))
  const upperIndex = SCORE_STOPS.findIndex(([stop]) => stop >= clamped)
  if (upperIndex <= 0) {
    return SCORE_STOPS[Math.max(0, upperIndex)]?.[1] ?? '#0d366b'
  }
  const lower = SCORE_STOPS[upperIndex - 1]
  const upper = SCORE_STOPS[upperIndex]
  if (!lower || !upper) return '#0d366b'
  const t = (clamped - lower[0]) / (upper[0] - lower[0])
  return mix(lower[1], upper[1], t)
}

export const SCORE_GRADIENT_CSS = `linear-gradient(to right, ${SCORE_STOPS.map(
  ([score, color]) => `${color} ${score}%`,
).join(', ')})`
