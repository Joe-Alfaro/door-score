import { seriesColor } from '../palette'

export interface LegendEntry {
  label: string
  value: string
  colorIndex?: number
  color?: string
}

/** Visible value list that accompanies every chart (required contrast relief for the palette). */
export function ChartLegend({ entries }: { entries: LegendEntry[] }) {
  return (
    <ul className="console-chart-legend">
      {entries.map((entry) => (
        <li key={entry.label} style={{ display: 'contents' }}>
          <span>
            <span className="console-swatch" style={{ background: entry.color ?? seriesColor(entry.colorIndex ?? 0) }} aria-hidden="true" />
            {entry.label}
          </span>
          <span className="console-num">{entry.value}</span>
        </li>
      ))}
    </ul>
  )
}
