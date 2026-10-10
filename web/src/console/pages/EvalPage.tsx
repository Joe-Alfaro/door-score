import { useMemo, useState } from 'react'
import { Card } from 'primereact/card'
import { Chart } from 'primereact/chart'
import { Chip } from 'primereact/chip'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { DataView } from 'primereact/dataview'
import { Dropdown } from 'primereact/dropdown'
import { Tag } from 'primereact/tag'
import { evalImageUrl, getEval } from '../api'
import { ChartLegend, EmptyState, ErrorPanel, LoadingPanel, PageHeader } from '../components'
import type { LegendEntry } from '../components'
import { DASH, humanize, pct, usd } from '../format'
import { useApi } from '../hooks'
import { GRIDLINE, MUTED_INK, seriesColor } from '../palette'
import { BINARY_LABEL_KEYS, RATING_LABEL_KEYS } from '../types'
import type { BinaryMetrics, EvalLabel, ModelEval, RatingMetrics, SignalMetrics } from '../types'

function isBinary(metrics: SignalMetrics): metrics is BinaryMetrics {
  return 'precision' in metrics
}

function isRating(metrics: SignalMetrics): metrics is RatingMetrics {
  return 'exact_agreement' in metrics
}

interface SignalRow {
  signal: string
  perModel: Record<string, SignalMetrics | undefined>
}

function collectRows(models: Array<[string, ModelEval]>, keep: (metrics: SignalMetrics) => boolean): SignalRow[] {
  const names = [...new Set(models.flatMap(([, result]) => Object.entries(result.signals).filter(([, metrics]) => keep(metrics)).map(([name]) => name)))]
  return names.map((signal) => ({
    signal,
    perModel: Object.fromEntries(models.map(([key, result]) => [key, result.signals[signal]])),
  }))
}

function BinaryCell({ metrics }: { metrics: SignalMetrics | undefined }) {
  if (!metrics || !isBinary(metrics)) return <span className="console-muted">{DASH}</span>
  return (
    <span className="console-num" title={`tp ${metrics.tp} · fp ${metrics.fp} · fn ${metrics.fn}`}>
      P {pct(metrics.precision)} · R {pct(metrics.recall)} · F1 {pct(metrics.f1)}
      <br />
      <span className="console-muted">halluc. {pct(metrics.hallucination_rate, 1)} · n+ {metrics.support_pos ?? DASH}</span>
    </span>
  )
}

function RatingCell({ metrics }: { metrics: SignalMetrics | undefined }) {
  if (!metrics || !isRating(metrics)) return <span className="console-muted">{DASH}</span>
  return (
    <span className="console-num">
      exact {pct(metrics.exact_agreement)} · within one {pct(metrics.within_one_step)}
      <br />
      <span className="console-muted">n {metrics.n}</span>
    </span>
  )
}

const LINE_OPTIONS = {
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: { legend: { display: false } },
  scales: {
    x: { title: { display: true, text: 'confidence gate', color: MUTED_INK }, grid: { display: false }, ticks: { color: MUTED_INK } },
    y: { min: 0, max: 1, grid: { color: GRIDLINE }, border: { display: false }, ticks: { color: MUTED_INK, callback: (value: string | number) => `${Math.round(Number(value) * 100)}%` } },
  },
}

interface SweepChart {
  data: { labels: string[]; datasets: Array<{ label: string; data: Array<number | null>; borderColor: string; borderDash?: number[]; tension: number; pointRadius: number; borderWidth: number }> }
  legend: LegendEntry[]
}

function buildSweep(result: ModelEval): SweepChart | null {
  const sweep = result.threshold_sweep
  if (!sweep) return null
  const thresholds = Object.keys(sweep).sort((a, b) => Number(a) - Number(b))
  const supported = Object.entries(result.signals)
    .filter((entry): entry is [string, BinaryMetrics] => isBinary(entry[1]) && (entry[1].support_pos ?? 0) > 0)
    .map(([name]) => name)
  if (thresholds.length === 0 || supported.length === 0) return null
  const datasets = supported.flatMap((name, index) => {
    const color = seriesColor(index)
    const series = (metric: 'precision' | 'recall') => thresholds.map((threshold) => sweep[threshold]?.[name]?.[metric] ?? null)
    return [
      { label: `${humanize(name)} precision`, data: series('precision'), borderColor: color, tension: 0.2, pointRadius: 4, borderWidth: 2 },
      { label: `${humanize(name)} recall`, data: series('recall'), borderColor: color, borderDash: [6, 4], tension: 0.2, pointRadius: 4, borderWidth: 2 },
    ]
  })
  const base = thresholds[0]
  const legend = supported.map((name, index) => {
    const metrics = base ? sweep[base]?.[name] : undefined
    return { label: humanize(name), value: `P ${pct(metrics?.precision)} / R ${pct(metrics?.recall)} at ${base ?? DASH}`, colorIndex: index }
  })
  return { data: { labels: thresholds, datasets }, legend }
}

function trueLabels(label: EvalLabel): string[] {
  return BINARY_LABEL_KEYS.filter((key) => label[key] === true).map(humanize)
}

function ratingText(label: EvalLabel): string {
  return RATING_LABEL_KEYS.map((key) => `${key.replace('_condition', '')}: ${label[key] ?? DASH}`).join(' · ')
}

function GalleryItem({ label }: { label: EvalLabel }) {
  const chips = trueLabels(label)
  return (
    <article className="console-gallery-item">
      {label.image ? <img src={evalImageUrl(label.image)} alt={`Labeled Street View frame for ${label.door_id}`} loading="lazy" /> : <div className="console-empty">No image</div>}
      <div className="console-gallery-body">
        <div className="console-tags">
          <code className="console-mono">{label.door_id}</code>
          {label.verified_by_human ? <Tag severity="success" icon="pi pi-check" value="verified" /> : <Tag severity="secondary" value="unverified" />}
          {label.image_usable === false ? <Tag severity="warning" value="unusable" /> : null}
        </div>
        <div className="console-tags">{chips.length === 0 ? <span className="console-muted">no positive labels</span> : chips.map((chip) => <Chip key={chip} label={chip} />)}</div>
        <div className="console-muted">{ratingText(label)}</div>
        {label.note ? <div>{label.note}</div> : null}
      </div>
    </article>
  )
}

type GalleryFilter = 'all' | 'positives' | 'unusable'

export function EvalPage() {
  const { data, error, loading, reload } = useApi(getEval, [])
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>('all')

  const models = useMemo(() => Object.entries(data?.results ?? {}).sort(([a], [b]) => a.localeCompare(b)), [data])
  const productionKey = models.find(([key, result]) => result.cost?.production?.model === key)?.[0] ?? models[models.length - 1]?.[0]
  const production = productionKey ? data?.results[productionKey] : undefined
  const overheadModels = useMemo(() => Object.entries(data?.overhead?.results ?? {}).sort(([a], [b]) => a.localeCompare(b)), [data])
  const overheadRows = useMemo<SignalRow[]>(() => {
    const names = ['swimming_pool', 'solar_panels', 'play_equipment', 'detached_structure']
    return names.map((signal) => ({ signal, perModel: Object.fromEntries(overheadModels.map(([key, result]) => [key, result.signals[signal]])) }))
  }, [overheadModels])
  const binaryRows = useMemo(() => collectRows(models, isBinary), [models])
  const ratingRows = useMemo(() => collectRows(models, isRating), [models])
  const sweep = useMemo(() => (production ? buildSweep(production) : null), [production])

  const labels = useMemo(() => {
    const all = data?.labels ?? []
    if (galleryFilter === 'positives') return all.filter((label) => trueLabels(label).length > 0)
    if (galleryFilter === 'unusable') return all.filter((label) => label.image_usable === false)
    return all
  }, [data, galleryFilter])

  if (loading && !data) return <LoadingPanel rows={6} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null
  if (models.length === 0) return <EmptyState icon="pi pi-check-square" title="No eval results yet" hint="Run the eval stage from the Pipeline page." />

  const cost = production?.cost

  return (
    <>
      <PageHeader title="Eval" subtitle={`${data.labels.length} labeled frames, ${data.n_verified} verified by a human. Metrics at each model's confidence gate.`} />

      {cost ? (
        <p className="console-muted" style={{ marginTop: -10 }}>
          Production model <strong>{cost.production?.model ?? DASH}</strong>: {usd(cost.production?.usd)} across {cost.production?.doors ?? DASH} doors ({usd(cost.production?.usd_per_door, 4)}/door) · eval and discovery {usd(cost.eval_and_discovery_usd)} · total {usd(cost.total_usd)}
        </p>
      ) : null}

      <div className="console-tags" style={{ marginBottom: 14 }}>
        {models.map(([key, result]) => (
          <Tag key={key} severity={key === productionKey ? 'success' : 'secondary'} value={`${key}${key === productionKey ? ' · production' : ''} · gate ${result.conf_threshold ?? DASH} · n ${result.n_labeled ?? DASH}`} />
        ))}
      </div>

      <Card title="Binary signals" subTitle="Precision / recall / F1 and hallucination rate (false positives over negatives)">
        <DataTable value={binaryRows} dataKey="signal" size="small" emptyMessage="No binary signals">
          <Column header="Signal" body={(row: SignalRow) => humanize(row.signal)} />
          {models.map(([key]) => (
            <Column key={key} header={key} body={(row: SignalRow) => <BinaryCell metrics={row.perModel[key]} />} />
          ))}
        </DataTable>
      </Card>

      {overheadModels.length > 0 ? (
        <Card title="Overhead imagery" subTitle={`Satellite tiles judged by a human (${data.overhead?.n_verified ?? 0} verified). Bare tile vs. tile with the parcel outline drawn on it (production).`} className="console-section">
          <DataTable value={overheadRows} dataKey="signal" size="small" emptyMessage="No overhead signals">
            <Column header="Signal" body={(row: SignalRow) => humanize(row.signal)} />
            {overheadModels.map(([key]) => (
              <Column key={key} header={key.includes('outline') ? `${key} · production` : key} body={(row: SignalRow) => <BinaryCell metrics={row.perModel[key]} />} />
            ))}
          </DataTable>
        </Card>
      ) : null}

      <Card title="Condition ratings" subTitle="Agreement with the human label on ordinal scales" className="console-section">
        <DataTable value={ratingRows} dataKey="signal" size="small" emptyMessage="No rating signals">
          <Column header="Signal" body={(row: SignalRow) => humanize(row.signal)} />
          {models.map(([key]) => (
            <Column key={key} header={key} body={(row: SignalRow) => <RatingCell metrics={row.perModel[key]} />} />
          ))}
        </DataTable>
      </Card>

      <Card title={`Threshold sweep · ${productionKey ?? DASH}`} subTitle="Solid = precision, dashed = recall, for signals with positive support" className="console-section">
        {sweep ? (
          <>
            <div className="console-chart" style={{ height: 300 }}>
              <Chart type="line" data={sweep.data} options={LINE_OPTIONS} />
            </div>
            <ChartLegend entries={sweep.legend} />
          </>
        ) : (
          <div className="console-muted">No threshold sweep with supported signals.</div>
        )}
      </Card>

      <section className="console-section">
        <div className="console-toolbar">
          <h2 className="console-section-title" style={{ margin: 0 }}>
            Labeled sample
          </h2>
          <Dropdown
            value={galleryFilter}
            options={[
              { label: 'All frames', value: 'all' },
              { label: 'With positive labels', value: 'positives' },
              { label: 'Unusable frames', value: 'unusable' },
            ]}
            onChange={(event) => setGalleryFilter(event.value === 'positives' || event.value === 'unusable' ? event.value : 'all')}
          />
          <span className="console-muted">{labels.length} frames</span>
        </div>
        {labels.length === 0 ? (
          <EmptyState icon="pi pi-images" title="No labeled frames match" />
        ) : (
          <DataView value={labels} layout="grid" paginator rows={12} listTemplate={(items: EvalLabel[]) => <div className="console-gallery">{items.map((label) => <GalleryItem key={label.door_id} label={label} />)}</div>} />
        )}
      </section>
    </>
  )
}
