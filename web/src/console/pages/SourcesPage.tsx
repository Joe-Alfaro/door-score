import { useMemo, useState } from 'react'
import { Chip } from 'primereact/chip'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import type { DataTableRowToggleEvent } from 'primereact/datatable'
import { Dropdown } from 'primereact/dropdown'
import { InputText } from 'primereact/inputtext'
import { Tag } from 'primereact/tag'
import { getSources } from '../api'
import { EmptyState, ErrorPanel, LoadingPanel, PageHeader } from '../components'
import { DASH, text, usd } from '../format'
import { useApi } from '../hooks'
import type { DataSource } from '../types'

interface SourceRow extends DataSource {
  /** Names are not guaranteed unique (the discovery agent can register duplicates). */
  row_key: string
}

type Severity = 'success' | 'info' | 'warning' | 'danger' | 'secondary'

function piiSeverity(risk: string | null | undefined): Severity {
  const value = (risk ?? '').toLowerCase()
  if (value === '' ) return 'secondary'
  if (value.includes('none') || value.includes('aggregate')) return 'success'
  if (value.includes('low')) return 'info'
  if (value.includes('medium') || value.includes('moderate')) return 'warning'
  return 'danger'
}

function accessSeverity(access: string | null | undefined): Severity {
  const value = (access ?? '').toLowerCase()
  if (value === '') return 'secondary'
  if (/(api|service|download|bulk|socrata|arcgis|csv|geojson)/.test(value)) return 'success'
  return 'warning'
}

function BoolIcon({ value, trueTitle, falseTitle }: { value: boolean | null | undefined; trueTitle: string; falseTitle: string }) {
  if (value === null || value === undefined) return <span className="console-muted">{DASH}</span>
  return <i className={value ? 'pi pi-check-circle' : 'pi pi-times-circle'} style={{ color: value ? '#0ca30c' : '#d03b3b' }} title={value ? trueTitle : falseTitle} aria-label={value ? trueTitle : falseTitle} />
}

function distinct(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))].sort()
}

function expansion(row: SourceRow) {
  return (
    <div className="console-expansion">
      {row.fields && row.fields.length > 0 ? (
        <div className="console-tags">
          {row.fields.map((field) => (
            <Chip key={field} label={field} />
          ))}
        </div>
      ) : (
        <span className="console-muted">No field list recorded.</span>
      )}
      <div>
        <strong>Join key:</strong> {text(row.join_key)}
      </div>
      <div>
        <strong>ToS note:</strong> {text(row.tos_note)}
      </div>
      <div>
        <strong>ICP use:</strong> {text(row.icp_use)}
      </div>
    </div>
  )
}

export function SourcesPage() {
  const { data, error, loading, reload } = useApi(getSources, [])
  const [search, setSearch] = useState('')
  const [dataType, setDataType] = useState<string | null>(null)
  const [piiRisk, setPiiRisk] = useState<string | null>(null)
  const [tosOnly, setTosOnly] = useState<boolean | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const rows = useMemo<SourceRow[]>(() => (data?.sources ?? []).map((source, index) => ({ ...source, row_key: `${index}` })), [data])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (dataType && row.data_type !== dataType) return false
      if (piiRisk && row.pii_risk !== piiRisk) return false
      if (tosOnly !== null && (row.tos_ok ?? false) !== tosOnly) return false
      if (needle.length === 0) return true
      return [row.name, row.publisher, row.icp_use, row.access].some((field) => (field ?? '').toLowerCase().includes(needle))
    })
  }, [rows, search, dataType, piiRisk, tosOnly])

  function handleToggle(event: DataTableRowToggleEvent) {
    if (Array.isArray(event.data)) {
      const next: Record<string, boolean> = {}
      event.data.forEach((row: SourceRow) => {
        next[row.row_key] = true
      })
      setExpanded(next)
      return
    }
    setExpanded(event.data)
  }

  if (loading && !data) return <LoadingPanel rows={6} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  return (
    <>
      <PageHeader title="Sources" subtitle={data.territory ?? undefined} />

      <div className="console-grid console-grid-2" style={{ marginBottom: 18 }}>
        <div className="console-tags" style={{ alignItems: 'center' }}>
          <Tag severity="secondary" value={`${rows.length} sources`} />
          <Tag severity="secondary" value={`${data.runs ?? DASH} discovery runs`} />
          <Tag severity="secondary" icon="pi pi-dollar" value={`${usd(data.usd)} discovery spend`} />
        </div>
        <div>
          <div className="console-h">Wired in pipeline</div>
          {data.wired_in_pipeline && data.wired_in_pipeline.length > 0 ? (
            <ul className="console-inline-list">
              {data.wired_in_pipeline.map((item) => (
                <li key={item}>
                  <Tag severity="success" icon="pi pi-link" value={item} />
                </li>
              ))}
            </ul>
          ) : (
            <span className="console-muted">Nothing recorded.</span>
          )}
        </div>
      </div>

      <div className="console-toolbar">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, publisher, use" />
        </span>
        <Dropdown value={dataType} options={distinct(rows.map((row) => row.data_type))} onChange={(event) => setDataType(typeof event.value === 'string' ? event.value : null)} placeholder="Data type" showClear />
        <Dropdown value={piiRisk} options={distinct(rows.map((row) => row.pii_risk))} onChange={(event) => setPiiRisk(typeof event.value === 'string' ? event.value : null)} placeholder="PII risk" showClear />
        <Dropdown
          value={tosOnly}
          options={[
            { label: 'ToS ok', value: true },
            { label: 'ToS not ok', value: false },
          ]}
          onChange={(event) => setTosOnly(typeof event.value === 'boolean' ? event.value : null)}
          placeholder="ToS"
          showClear
        />
        <span className="console-muted">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="pi pi-database" title="No sources discovered yet" hint="Run the discovery stage from the Pipeline page." />
      ) : (
        <DataTable value={filtered} dataKey="row_key" size="small" expandedRows={expanded} onRowToggle={handleToggle} rowExpansionTemplate={expansion} emptyMessage="No sources match these filters" paginator rows={15} sortField="name" sortOrder={1}>
          <Column expander style={{ width: 40 }} />
          <Column field="name" header="Name" sortable body={(row: SourceRow) => (row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.name}</a> : row.name)} />
          <Column field="publisher" header="Publisher" sortable body={(row: SourceRow) => text(row.publisher)} />
          <Column field="data_type" header="Type" sortable body={(row: SourceRow) => (row.data_type ? <Tag severity="info" value={row.data_type} /> : DASH)} />
          <Column field="access" header="Access" sortable body={(row: SourceRow) => (row.access ? <Tag severity={accessSeverity(row.access)} value={row.access} /> : DASH)} />
          <Column field="tos_ok" header="ToS" sortable body={(row: SourceRow) => <BoolIcon value={row.tos_ok} trueTitle="Terms permit this use" falseTitle="Terms unclear or disallow" />} />
          <Column field="pii_risk" header="PII" sortable body={(row: SourceRow) => (row.pii_risk ? <Tag severity={piiSeverity(row.pii_risk)} value={row.pii_risk} /> : DASH)} />
          <Column header="Reachable" body={(row: SourceRow) => (row.probe ? <span><BoolIcon value={row.probe.reachable} trueTitle="Probe succeeded" falseTitle="Probe failed" /> <span className="console-muted">{row.probe.status ?? ''}</span></span> : <span className="console-muted">not probed</span>)} />
          <Column header="ICP use" body={(row: SourceRow) => <span className="console-truncate" title={row.icp_use ?? undefined}>{text(row.icp_use)}</span>} />
        </DataTable>
      )}
    </>
  )
}
