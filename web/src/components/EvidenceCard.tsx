import { formatBoolean, formatCurrency, formatDate, formatNumber, humanize, scoreColor } from '../lib'
import type { DoorFeature, Permits } from '../types'
import { SignalRow } from './SignalRow'
import { StreetViewPhoto } from './StreetViewPhoto'

interface EvidenceCardProps {
  door: DoorFeature
  total: number
  onClose: () => void
}

interface FactProps {
  label: string
  value: string
  /** Span both columns of the facts grid for long values. */
  wide?: boolean
}

function Fact({ label, value, wide = false }: FactProps) {
  return (
    <div className={wide ? 'fact fact-wide' : 'fact'}>
      <dt className="fact-label muted">{label}</dt>
      <dd className="fact-value">{value}</dd>
    </div>
  )
}

function formatLatestPermit(permits: Permits | null | undefined): string {
  if (!permits || (!permits.latest_type && !permits.latest_date)) return '—'
  const head = [permits.latest_type, permits.latest_date ? formatDate(permits.latest_date) : null]
    .filter((part): part is string => Boolean(part))
    .join(' ')
  const cost = permits.latest_cost && permits.latest_cost > 0 ? ` · ${formatCurrency(permits.latest_cost)}` : ''
  return `${head}${cost}`
}

function formatTrades(permits: Permits | null | undefined): string {
  const trades = permits?.trades_5yr ?? []
  return trades.length > 0 ? trades.join(', ') : '—'
}

export function EvidenceCard({ door, total, onClose }: EvidenceCardProps) {
  const props = door.properties
  const signals = [...props.signals].sort((a, b) => b.points - a.points)
  const why = signals.slice(0, 2).map((signal) => humanize(signal.name))

  return (
    <aside className="evidence-card" aria-label={`Evidence for ${props.address}`}>
      <button type="button" className="close" onClick={onClose} aria-label="Close panel">
        ×
      </button>

      <div className="card-header">
        <div>
          <h2 className="card-address">{props.address}</h2>
          <div className="muted">{props.municipality}</div>
        </div>
        <div className="score-block">
          <span className="score-dot" style={{ background: scoreColor(props.door_score_pct ?? props.door_score) }} aria-hidden="true" />
          <span className="score-number">{props.door_score}</span>
          <span className="score-rank muted">
            #{props.rank} of {formatNumber(total)}
            {typeof props.door_score_pct === 'number' ? ` · ${props.door_score_pct}th percentile` : ''}
          </span>
        </div>
      </div>

      {props.vision?.image ? (
        <StreetViewPhoto key={props.door_id} doorId={props.door_id} address={props.address} vision={props.vision} />
      ) : null}

      {props.tags.length > 0 ? (
        <div className="chips">
          {props.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {why.length > 0 ? (
        <p className="why">
          <span className="why-label">Why this door</span> {why.join(' · ')}
        </p>
      ) : null}

      <h3 className="section-title">Signals</h3>
      <ul className="signal-list">
        {signals.map((signal, index) => (
          <SignalRow key={`${signal.name}-${index}`} signal={signal} />
        ))}
      </ul>

      <h3 className="section-title">Property</h3>
      <dl className="facts">
        <Fact label="Year built" value={props.year_built ? `${props.year_built} (${formatNumber(props.home_age)} yrs)` : '—'} />
        <Fact label="Lot" value={props.lot_acres ? `${formatNumber(props.lot_acres, 2)} ac` : '—'} />
        <Fact label="Assessed" value={formatCurrency(props.net_value)} />
        <Fact label="Deed" value={formatDate(props.deed_date)} />
        <Fact label="Sale price" value={formatCurrency(props.sale_price)} />
        <Fact label="Owner occupied" value={formatBoolean(props.owner_occupied)} />
        <Fact label="Stories" value={formatNumber(props.stories)} />
        <Fact label="Garage bays" value={formatNumber(props.garage_bays)} />
        <Fact label="Permits (5 yr)" value={formatNumber(props.permits?.permits_5yr)} />
        <Fact label="Latest permit" value={formatLatestPermit(props.permits)} />
        <Fact label="Trades" value={formatTrades(props.permits)} wide />
      </dl>
    </aside>
  )
}
