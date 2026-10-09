import { Chip } from 'primereact/chip'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { ProgressBar } from 'primereact/progressbar'
import { Tag } from 'primereact/tag'
import { getDoor } from '../api'
import { DASH, humanize, num, pct, text, usd, yesNo } from '../format'
import { useApi } from '../hooks'
import type { DoorDetail, Signal, VisionBlock, VisionFlag, VisionSignalValue } from '../types'
import { ErrorPanel, LoadingPanel } from './Panels'
import { StreetViewImage } from './StreetViewImage'

function isVisionFlag(value: VisionSignalValue): value is VisionFlag {
  return typeof value === 'object' && value !== null && 'present' in value
}

interface Fact {
  label: string
  value: string
}

function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="console-facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function signalPointsBody(signal: Signal) {
  const ratio = signal.max_points > 0 ? Math.round((signal.points / signal.max_points) * 100) : 0
  return (
    <ProgressBar
      value={ratio}
      style={{ height: 16, minWidth: 90 }}
      displayValueTemplate={() => (
        <span style={{ fontSize: 11 }}>
          {signal.points}/{signal.max_points}
        </span>
      )}
    />
  )
}

/** Detections, ratings and notes from one vision pass (street or satellite). */
function VisionSummary({ title, block }: { title: string; block: VisionBlock | null | undefined }) {
  if (!block || !block.signals) {
    return (
      <section>
        <h3 className="console-h">{title}</h3>
        <div className="console-muted">Not run for this door.</div>
      </section>
    )
  }
  const entries = Object.entries(block.signals)
  const detections = entries.filter((entry): entry is [string, VisionFlag] => isVisionFlag(entry[1]) && entry[1].present)
  const ratings = entries.filter((entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number')
  const notes = block.signals.notes
  const usable = block.signals.image_usable

  return (
    <section>
      <h3 className="console-h">{title}</h3>
      <div className="console-grid" style={{ gap: 8 }}>
        <div className="console-tags">
          {usable === false ? <Tag severity="warning" value="image unusable" /> : null}
          {detections.length === 0 ? <span className="console-muted">No detections.</span> : null}
          {detections.map(([name, flag]) => (
            <Tag key={name} severity="info" value={`${humanize(name)}${flag.confidence !== null && flag.confidence !== undefined ? ` ${pct(flag.confidence)}` : ''}`} title={flag.evidence ?? undefined} />
          ))}
        </div>
        {ratings.length > 0 ? (
          <ul className="console-inline-list console-muted">
            {ratings
              .filter(([name]) => name !== 'notes' && name !== 'usability_note')
              .map(([name, value]) => (
                <li key={name}>
                  {humanize(name)}: <strong>{String(value)}</strong>
                </li>
              ))}
          </ul>
        ) : null}
        {typeof notes === 'string' && notes.length > 0 ? <div style={{ fontSize: 13 }}>{notes}</div> : null}
        <div className="console-muted" style={{ fontSize: 12 }}>
          {text(block.model)} · {usd(block.usd, 4)}
        </div>
      </div>
    </section>
  )
}

function DoorBody({ door }: { door: DoorDetail }) {
  const signals = door.signals ?? []
  const permits = door.permits
  const census = door.census
  const neighborhood = door.neighborhood

  return (
    <div className="console-door">
      <div className="console-door-head">
        <div>
          <h2 className="console-door-address">{door.address}</h2>
          <div className="console-muted">
            {door.municipality} · rank #{door.rank}
            {door.door_score_pct !== null && door.door_score_pct !== undefined ? ` · ${door.door_score_pct}th percentile` : ''}
          </div>
        </div>
        <div>
          <div className="console-door-score">{door.door_score}</div>
          <div className="console-muted" style={{ textAlign: 'right', fontSize: 12 }}>
            Door Score
          </div>
        </div>
      </div>

      <div className="console-tags">
        {door.tags.map((tag) => (
          <Chip key={tag} label={tag} />
        ))}
      </div>

      <StreetViewImage doorId={door.door_id} className="console-door-photo" />

      <a className="p-button p-component p-button-outlined p-button-sm" href={`/?door=${encodeURIComponent(door.door_id)}`} style={{ justifySelf: 'start', textDecoration: 'none' }}>
        <i className="pi pi-map-marker p-button-icon p-button-icon-left" aria-hidden="true" />
        <span className="p-button-label">Open on map</span>
      </a>

      <section>
        <h3 className="console-h">Signals</h3>
        {signals.length === 0 ? (
          <div className="console-muted">No signals recorded.</div>
        ) : (
          <DataTable value={signals} size="small" dataKey="name" emptyMessage="No signals">
            <Column header="Signal" body={(signal: Signal) => humanize(signal.name)} />
            <Column header="Trait" body={(signal: Signal) => text(signal.icp_trait)} />
            <Column header="Points" body={signalPointsBody} style={{ width: 120 }} />
            <Column header="Evidence" body={(signal: Signal) => text(signal.evidence)} />
            <Column header="Source" body={(signal: Signal) => text(signal.source)} />
          </DataTable>
        )}
      </section>

      <section>
        <h3 className="console-h">Property</h3>
        <FactList
          facts={[
            { label: 'Year built', value: door.year_built ? String(door.year_built) : DASH },
            { label: 'Lot', value: door.lot_acres !== null && door.lot_acres !== undefined ? `${num(door.lot_acres, 2)} ac` : DASH },
            { label: 'Assessed value', value: door.net_value !== null && door.net_value !== undefined ? `$${num(door.net_value)}` : DASH },
            { label: 'Deed date', value: door.deed_date ? `${door.deed_date} (${num(door.months_since_deed)} mo)` : DASH },
            { label: 'Owner occupied', value: yesNo(door.owner_occupied) },
            { label: 'Sale price', value: door.sale_price !== null && door.sale_price !== undefined ? `$${num(door.sale_price)}` : DASH },
          ]}
        />
      </section>

      <section>
        <h3 className="console-h">Permits</h3>
        {permits ? (
          <FactList
            facts={[
              { label: 'Permits (5 yr / 10 yr)', value: `${num(permits.permits_5yr)} / ${num(permits.permits_10yr)}` },
              { label: 'Cost (5 yr)', value: permits.cost_5yr !== null && permits.cost_5yr !== undefined ? `$${num(permits.cost_5yr)}` : DASH },
              { label: 'Latest', value: permits.latest_date ? `${permits.latest_date} · ${text(permits.latest_type)}` : DASH },
              { label: 'Major project (5 yr)', value: yesNo(permits.major_project_5yr) },
              { label: 'Trades', value: permits.trades_5yr && permits.trades_5yr.length > 0 ? permits.trades_5yr.join(', ') : DASH },
            ]}
          />
        ) : (
          <div className="console-muted">No permit history matched.</div>
        )}
      </section>

      <section>
        <h3 className="console-h">Census tract</h3>
        {census ? (
          <FactList
            facts={[
              { label: 'Tract', value: text(census.tract_geoid) },
              { label: 'Median HH income', value: census.median_hh_income !== null && census.median_hh_income !== undefined ? `$${num(census.median_hh_income)}` : DASH },
              { label: 'Median home value', value: census.median_home_value !== null && census.median_home_value !== undefined ? `$${num(census.median_home_value)}` : DASH },
              { label: 'Dual earner share', value: pct(census.dual_earner_share) },
              { label: 'Owner occupied share', value: pct(census.owner_occupied_share) },
              { label: 'Moved last year', value: pct(census.moved_last_year_share) },
            ]}
          />
        ) : (
          <div className="console-muted">No tract profile.</div>
        )}
      </section>

      <VisionSummary title="Satellite detections" block={door.satellite} />
      <VisionSummary title="Street View detections" block={door.vision} />

      {neighborhood ? (
        <section>
          <h3 className="console-h">Neighborhood ({num(neighborhood.radius_m)} m)</h3>
          <FactList
            facts={[
              { label: 'Homes within', value: num(neighborhood.n_within) },
              { label: 'New movers', value: num(neighborhood.new_movers_within) },
              { label: 'Permits (3 yr)', value: num(neighborhood.permits_within_3yr) },
              { label: 'Activity percentile', value: neighborhood.activity_pct !== null && neighborhood.activity_pct !== undefined ? `${neighborhood.activity_pct}` : DASH },
            ]}
          />
        </section>
      ) : null}
    </div>
  )
}

export function DoorDetailPanel({ doorId }: { doorId: string }) {
  const { data, error, loading, reload } = useApi(() => getDoor(doorId), [doorId])
  if (loading) return <LoadingPanel rows={8} />
  if (error) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null
  return <DoorBody door={data} />
}
