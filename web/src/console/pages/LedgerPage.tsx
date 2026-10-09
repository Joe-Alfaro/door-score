import { useMemo, useState } from 'react'
import { Column } from 'primereact/column'
import { ColumnGroup } from 'primereact/columngroup'
import { DataTable } from 'primereact/datatable'
import { Dropdown } from 'primereact/dropdown'
import { Row } from 'primereact/row'
import { getLedger } from '../api'
import { EmptyState, ErrorPanel, LoadingPanel, PageHeader } from '../components'
import { DASH, fromEpoch, num, text, usd } from '../format'
import { useApi } from '../hooks'
import type { LedgerRow } from '../types'

const LIMITS = [200, 500, 1000, 5000]

function tokensBody(row: LedgerRow) {
  if (row.input_tokens === null || row.input_tokens === undefined) return <span className="console-muted">{DASH}</span>
  return (
    <span className="console-num" title="input / output tokens">
      {num(row.input_tokens)} / {num(row.output_tokens)}
    </span>
  )
}

export function LedgerPage() {
  const [limit, setLimit] = useState(200)
  const { data, error, loading, reload } = useApi(() => getLedger(limit), [limit])

  const rows = useMemo(() => [...(data?.rows ?? [])].sort((a, b) => b.ts - a.ts), [data])
  const total = useMemo(() => rows.reduce((sum, row) => sum + (row.usd || 0), 0), [rows])

  const footer = (
    <ColumnGroup>
      <Row>
        <Column footer={`Total of ${num(rows.length)} rows shown`} colSpan={5} footerStyle={{ textAlign: 'right' }} />
        <Column footer={usd(total, 4)} footerClassName="console-num" />
      </Row>
    </ColumnGroup>
  )

  if (loading && !data) return <LoadingPanel rows={6} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  return (
    <>
      <PageHeader title="Ledger" subtitle="Every billable call the pipeline made, newest first." />
      <div className="console-toolbar">
        <Dropdown value={limit} options={LIMITS.map((value) => ({ label: `last ${value}`, value }))} onChange={(event) => setLimit(typeof event.value === 'number' ? event.value : 200)} />
        <span className="console-muted">
          {num(rows.length)} of {num(data.total_rows ?? rows.length)} ledger rows
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="pi pi-dollar" title="No spend recorded" hint="Paid stages append to the ledger as they run." />
      ) : (
        <DataTable value={rows} size="small" paginator rows={25} rowsPerPageOptions={[25, 50, 100]} footerColumnGroup={footer} loading={loading} emptyMessage="No rows">
          <Column header="Time" body={(row: LedgerRow) => fromEpoch(row.ts)} />
          <Column field="stage" header="Stage" />
          <Column header="Model" body={(row: LedgerRow) => text(row.model)} />
          <Column header="Door" body={(row: LedgerRow) => <code className="console-mono">{text(row.door_id)}</code>} />
          <Column header="Tokens in / out" body={tokensBody} />
          <Column header="USD" className="console-num" body={(row: LedgerRow) => usd(row.usd, 4)} />
        </DataTable>
      )}
    </>
  )
}
