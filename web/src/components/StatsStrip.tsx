import type { DoorStats } from '../lib'
import { formatNumber } from '../lib'

interface StatsStripProps {
  stats: DoorStats
  visibleCount: number
}

interface StatTileProps {
  label: string
  value: string
  hint?: string
}

function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  )
}

export function StatsStrip({ stats, visibleCount }: StatsStripProps) {
  return (
    <section className="stats-strip" aria-label="Territory statistics">
      <StatTile
        label="Doors"
        value={formatNumber(stats.count)}
        hint={visibleCount === stats.count ? 'all shown' : `${formatNumber(visibleCount)} shown`}
      />
      <StatTile label="Median score" value={formatNumber(stats.medianScore, 1)} />
      <StatTile label="New movers" value={formatNumber(stats.newMovers)} />
      <StatTile label="Absentee owners" value={formatNumber(stats.absenteeOwners)} />
      <StatTile label="With imagery" value={formatNumber(stats.withImagery)} hint="usable Street View" />
      <StatTile label="Provider on site" value={formatNumber(stats.providerOnSite)} />
    </section>
  )
}
