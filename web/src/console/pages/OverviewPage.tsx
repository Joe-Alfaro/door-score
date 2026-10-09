import { Card } from 'primereact/card'
import { Chart } from 'primereact/chart'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Tag } from 'primereact/tag'
import { ChartLegend, ErrorPanel, LoadingPanel, PageHeader, StatCard, useConsoleStatus } from '../components'
import { DASH, fromEpoch, num, pctUnits, relativeTime, usd } from '../format'
import { GRIDLINE, MUTED_INK, SEQUENTIAL_BLUE, seriesColor } from '../palette'
import type { Deployment } from '../types'

interface DeploymentRow extends Deployment {
  name: string
}

function ratio(numerator: number | null | undefined, denominator: number | null | undefined): string {
  if (!numerator || !denominator) return DASH
  return pctUnits((numerator / denominator) * 100, 1)
}

const BAR_OPTIONS = {
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { color: MUTED_INK } },
    y: { beginAtZero: true, grid: { color: GRIDLINE }, border: { display: false }, ticks: { color: MUTED_INK, callback: (value: string | number) => `$${value}` } },
  },
} as const

const DOUGHNUT_OPTIONS = {
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: { legend: { display: false } },
} as const

export function OverviewPage() {
  const { status, health, loading, error, reload } = useConsoleStatus()

  if (loading && !status) return <LoadingPanel rows={6} />
  if (error && !status) return <ErrorPanel message={error} onRetry={reload} />
  if (!status) return null

  const report = status.report
  const cost = status.cost
  const byModel = Object.entries(cost.by_model ?? {}).sort((a, b) => b[1] - a[1])
  const byStage = Object.entries(cost.by_stage ?? {}).sort((a, b) => b[1] - a[1])
  const deployments: DeploymentRow[] = Object.entries(status.deployments ?? {}).map(([name, deployment]) => ({ name, ...deployment }))

  const doughnutData = {
    labels: byModel.map(([model]) => model),
    datasets: [{ data: byModel.map(([, value]) => value), backgroundColor: byModel.map((_, index) => seriesColor(index)), borderColor: '#ffffff', borderWidth: 2 }],
  }
  const barData = {
    labels: byStage.map(([stage]) => stage.replace(/_/g, ' ')),
    datasets: [{ data: byStage.map(([, value]) => value), backgroundColor: SEQUENTIAL_BLUE, borderRadius: 4, barThickness: 22 }],
  }

  return (
    <>
      <PageHeader title="Overview" subtitle={`Pipeline state for ${status.territory?.name ?? 'the territory'}.`} />

      <div className="console-grid console-grid-stats">
        <StatCard label="Doors" value={num(health?.doors ?? report.single_family_homes)} hint={`${num(report.parcels_in_polygon)} parcels in polygon`} />
        <StatCard label="Usable imagery" value={ratio(report.doors_with_usable_imagery, report.doors_with_imagery)} hint={`${num(report.doors_with_usable_imagery)} of ${num(report.doors_with_imagery)} frames`} />
        <StatCard label="Permits matched" value={num(report.doors_with_permit_history)} hint="doors with permit history" />
        <StatCard label="Absentee owners" value={num(report.absentee_owners)} />
        <StatCard label="New movers" value={num(report.new_movers_36mo)} hint="deed in last 36 months" />
        <StatCard label="Production $/door" value={usd(cost.production?.usd_per_door, 4)} hint={cost.production ? `${cost.production.model} · ${usd(cost.production.usd)} total` : undefined} />
      </div>

      <div className="console-grid console-grid-2 console-section">
        <Card title="Spend by model" subTitle={`${usd(cost.total_usd)} total`}>
          {byModel.length === 0 ? (
            <div className="console-muted">No spend recorded.</div>
          ) : (
            <>
              <div className="console-chart">
                <Chart type="doughnut" data={doughnutData} options={DOUGHNUT_OPTIONS} />
              </div>
              <ChartLegend entries={byModel.map(([model, value], index) => ({ label: model, value: usd(value), colorIndex: index }))} />
            </>
          )}
        </Card>
        <Card title="Spend by stage" subTitle={cost.eval_and_discovery_usd !== null && cost.eval_and_discovery_usd !== undefined ? `${usd(cost.eval_and_discovery_usd)} of it on eval and discovery` : undefined}>
          {byStage.length === 0 ? (
            <div className="console-muted">No spend recorded.</div>
          ) : (
            <>
              <div className="console-chart">
                <Chart type="bar" data={barData} options={BAR_OPTIONS} />
              </div>
              <ChartLegend entries={byStage.map(([stage, value]) => ({ label: stage.replace(/_/g, ' '), value: usd(value), color: SEQUENTIAL_BLUE }))} />
            </>
          )}
        </Card>
      </div>

      <div className="console-grid console-grid-2 console-section">
        <Card title="Deployments">
          <DataTable value={deployments} size="small" dataKey="name" emptyMessage="No deployments configured">
            <Column field="name" header="Service" />
            <Column header="URL" body={(row: DeploymentRow) => <a href={row.url} target="_blank" rel="noreferrer">{row.url}</a>} />
            <Column header="Health" body={(row: DeploymentRow) => <Tag severity={row.ok ? 'success' : 'danger'} value={row.ok ? 'ok' : 'down'} />} />
            <Column header="Status" body={(row: DeploymentRow) => String(row.status)} />
            <Column header="Latency" className="console-num" body={(row: DeploymentRow) => (row.ms === null ? DASH : `${row.ms} ms`)} />
          </DataTable>
        </Card>
        <Card title="Last pipeline run">
          <div className="console-stat-value">{relativeTime(status.doors_file_mtime)}</div>
          <div className="console-muted">{fromEpoch(status.doors_file_mtime)} · doors.json written</div>
          <div className="console-section" style={{ marginTop: 14 }}>
            <div className="console-tags">
              {Object.entries(status.keys).map(([name, present]) => (
                <Tag key={name} severity={present ? 'success' : 'warning'} icon={present ? 'pi pi-key' : 'pi pi-exclamation-triangle'} value={`${name} key ${present ? 'set' : 'missing'}`} />
              ))}
            </div>
          </div>
          <div className="console-muted" style={{ marginTop: 12, fontSize: 12 }}>
            Deed dates resolved for {pctUnits(report.pct_with_deed_date, 1)} of homes · usable satellite for {num(report.doors_with_usable_satellite)} doors
          </div>
        </Card>
      </div>
    </>
  )
}
