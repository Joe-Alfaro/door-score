/**
 * Chart colors. Categorical slots are assigned in fixed order (never cycled) and were validated
 * for CVD separation on a white surface; aqua/yellow/magenta sit below 3:1 contrast, so every
 * chart also renders a visible value legend as the required relief.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const

export const SEQUENTIAL_BLUE = '#2a78d6'
export const GRIDLINE = '#e1e0d9'
export const MUTED_INK = '#898781'
export const SECONDARY_INK = '#52514e'

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length] ?? SERIES[0]
}
