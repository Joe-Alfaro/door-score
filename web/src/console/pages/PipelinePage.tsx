import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Column } from 'primereact/column'
import { confirmDialog } from 'primereact/confirmdialog'
import { DataTable } from 'primereact/datatable'
import { InputNumber } from 'primereact/inputnumber'
import { Message } from 'primereact/message'
import { Tag } from 'primereact/tag'
import { cancelRun, getRun, getRuns, getStages, parseStreamEvent, runStage, runStreamUrl } from '../api'
import { EmptyState, ErrorPanel, LoadingPanel, PageHeader, Terminal, useToast } from '../components'
import { DASH, duration, fromEpoch, usd } from '../format'
import { errorMessage, useApi, useInterval } from '../hooks'
import type { RunRecord, RunStatus, Stage } from '../types'

/** Measured per-door production cost (Street View + satellite + two vision calls). */
const USD_PER_DOOR = 0.0241
const POLL_MS = 3000

function stageEstimate(stage: Stage, limit: number | null): number {
  if (stage.accepts_limit && limit && limit > 0) return Math.round(limit * USD_PER_DOOR * 100) / 100
  return stage.estimate_usd
}

function statusSeverity(status: RunStatus): 'info' | 'success' | 'danger' | 'warning' | 'secondary' {
  if (status === 'running') return 'info'
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'cancelled') return 'warning'
  return 'secondary'
}

interface StreamState {
  runId: string
  lines: string[]
  finished: { status: RunStatus; exit_code: number | null } | null
}

interface StageCardProps {
  stage: Stage
  disabled: boolean
  submitting: boolean
  limit: number | null
  onLimitChange: (value: number | null) => void
  onRun: () => void
}

function StageCard({ stage, disabled, submitting, limit, onLimitChange, onRun }: StageCardProps) {
  const estimate = stageEstimate(stage, limit)
  const cacheEntries = Object.entries(stage.cache)
  return (
    <Card title={stage.title} subTitle={stage.description}>
      <div className="console-tags">
        {stage.paid ? <Tag severity={estimate > 0 ? 'warning' : 'success'} icon="pi pi-dollar" value={estimate > 0 ? `${usd(estimate)} est.` : 'free (cached)'} /> : <Tag severity="success" value="free" />}
        {cacheEntries.map(([name, count]) => (
          <Tag key={name} severity="secondary" value={`${name.replace(/_/g, ' ')}: ${count}`} />
        ))}
      </div>
      {stage.needs.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <Message severity="warn" text={`Missing keys: ${stage.needs.join(', ')}`} />
        </div>
      ) : null}
      <div className="console-stage-actions">
        {stage.accepts_limit ? (
          <span className="p-inputgroup" style={{ width: 'auto' }}>
            <span className="p-inputgroup-addon">limit</span>
            <InputNumber value={limit} onValueChange={(event) => onLimitChange(event.value ?? null)} min={1} max={5000} placeholder="all doors" inputStyle={{ width: 110 }} />
            <span className="p-inputgroup-addon">doors</span>
          </span>
        ) : null}
        <Button label="Run" icon="pi pi-play" size="small" loading={submitting} disabled={disabled || stage.needs.length > 0} onClick={onRun} />
        <code className="console-mono console-muted">{stage.cmd.map((part) => part.split('/').pop()).join(' ')}</code>
      </div>
    </Card>
  )
}

export function PipelinePage() {
  const toast = useToast()
  const stages = useApi(getStages, [])
  const runs = useApi(getRuns, [])
  const [limits, setLimits] = useState<Record<string, number | null>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [stream, setStream] = useState<StreamState | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const toastRef = useRef(toast)
  toastRef.current = toast

  const activeRunId = stream && !stream.finished ? stream.runId : (stages.data?.active_run ?? null)
  const reloadStages = stages.reload
  const reloadRuns = runs.reload
  const reloadAll = useCallback(() => {
    reloadStages()
    reloadRuns()
  }, [reloadStages, reloadRuns])

  // A run started elsewhere (or before a page refresh) should still stream here.
  useEffect(() => {
    const serverActive = stages.data?.active_run
    if (!serverActive) return
    setStream((current) => (current?.runId === serverActive ? current : { runId: serverActive, lines: [], finished: null }))
  }, [stages.data?.active_run])

  useEffect(() => {
    if (!stream || stream.finished) return
    const runId = stream.runId
    const source = new EventSource(runStreamUrl(runId))
    const finish = (status: RunStatus, exitCode: number | null) => {
      source.close()
      setStream((current) => (current?.runId === runId ? { ...current, finished: { status, exit_code: exitCode } } : current))
      toastRef.current({ severity: status === 'succeeded' ? 'success' : 'warn', summary: `Run ${status}`, detail: `exit code ${exitCode ?? DASH}` })
      reloadAll()
    }
    source.onmessage = (message) => {
      const event = parseStreamEvent(String(message.data))
      if (!event) return
      if ('line' in event) {
        setStream((current) => (current?.runId === runId ? { ...current, lines: [...current.lines, event.line] } : current))
        return
      }
      finish(event.status, event.exit_code)
    }
    source.onerror = () => {
      // The stream dropped; recover the log tail and final status once instead of letting EventSource retry forever.
      source.close()
      getRun(runId)
        .then((record) => {
          setStream((current) => (current?.runId === runId ? { ...current, lines: record.log_tail } : current))
          if (record.status !== 'running') finish(record.status, record.exit_code ?? null)
        })
        .catch((reason: unknown) => toastRef.current({ severity: 'error', summary: 'Lost run stream', detail: errorMessage(reason) }))
    }
    return () => source.close()
    // Keyed on the run identity only: `stream.lines` changes on every event and must not resubscribe.
  }, [stream?.runId, stream?.finished, reloadAll])

  useInterval(reloadStages, activeRunId ? POLL_MS : null)

  async function start(stage: Stage, limit: number | null, confirmPaid: boolean) {
    setSubmitting(stage.id)
    try {
      const body = { ...(stage.accepts_limit && limit ? { limit } : {}), ...(confirmPaid ? { confirm_paid: true } : {}) }
      const record = await runStage(stage.id, body)
      setStream({ runId: record.id, lines: [], finished: null })
      toast({ severity: 'info', summary: `Started ${stage.title}`, detail: `run ${record.id}` })
      reloadAll()
    } catch (reason) {
      toast({ severity: 'error', summary: 'Could not start run', detail: errorMessage(reason), life: 8000 })
    } finally {
      setSubmitting(null)
    }
  }

  function handleRun(stage: Stage) {
    const limit = limits[stage.id] ?? null
    const estimate = stageEstimate(stage, limit)
    if (!stage.paid || estimate <= 0) {
      void start(stage, limit, false)
      return
    }
    confirmDialog({
      header: 'Paid stage',
      icon: 'pi pi-exclamation-triangle',
      message: `${stage.title} will bill roughly ${usd(estimate)}${limit ? ` for ${limit} doors` : ''}. Continue?`,
      acceptLabel: `Run (~${usd(estimate)})`,
      rejectLabel: 'Cancel',
      accept: () => void start(stage, limit, true),
    })
  }

  async function handleCancel() {
    if (!activeRunId) return
    setCancelling(true)
    try {
      await cancelRun(activeRunId)
      toast({ severity: 'warn', summary: 'Cancel requested', detail: `run ${activeRunId}` })
    } catch (reason) {
      toast({ severity: 'error', summary: 'Could not cancel', detail: errorMessage(reason) })
    } finally {
      setCancelling(false)
    }
  }

  if (stages.loading && !stages.data) return <LoadingPanel rows={5} />
  if (stages.error && !stages.data) return <ErrorPanel message={stages.error} onRetry={stages.reload} />
  if (!stages.data) return null

  const runLocked = activeRunId !== null || submitting !== null
  const activeStage = stream ? stages.data.stages.find((stage) => stage.id === (runs.data?.runs.find((run) => run.id === stream.runId)?.stage ?? ''))?.title : undefined

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={
          stages.data.spent_usd !== null && stages.data.spent_usd !== undefined
            ? `Stages run as subprocesses with live logs. ${usd(stages.data.spent_usd)} spent of a ${usd(stages.data.max_spend_usd, 0)} cap.`
            : 'Stages run as subprocesses with live logs.'
        }
      />

      {stream ? (
        <Card className="console-section" style={{ marginTop: 0, marginBottom: 20 }}>
          <div className="console-terminal-head">
            <strong>{activeStage ?? 'Run'}</strong>
            <code className="console-mono console-muted">{stream.runId}</code>
            {stream.finished ? (
              <Tag severity={statusSeverity(stream.finished.status)} value={`${stream.finished.status} · exit ${stream.finished.exit_code ?? DASH}`} />
            ) : (
              <Tag severity="info" icon="pi pi-spin pi-spinner" value="running" />
            )}
            {stream.finished ? (
              <Button label="Dismiss" icon="pi pi-times" size="small" text onClick={() => setStream(null)} />
            ) : (
              <Button label="Cancel run" icon="pi pi-stop-circle" size="small" severity="danger" outlined loading={cancelling} onClick={() => void handleCancel()} />
            )}
          </div>
          <Terminal lines={stream.lines} />
        </Card>
      ) : null}

      <div className="console-grid console-grid-2">
        {stages.data.stages.map((stage) => (
          <StageCard
            key={stage.id}
            stage={stage}
            disabled={runLocked}
            submitting={submitting === stage.id}
            limit={limits[stage.id] ?? null}
            onLimitChange={(value) => setLimits((current) => ({ ...current, [stage.id]: value }))}
            onRun={() => handleRun(stage)}
          />
        ))}
      </div>

      <section className="console-section">
        <h2 className="console-section-title">Recent runs</h2>
        {runs.error ? <ErrorPanel message={runs.error} onRetry={runs.reload} /> : null}
        {runs.data && runs.data.runs.length === 0 ? <EmptyState icon="pi pi-history" title="No runs yet" hint="Start a stage above to see it here." /> : null}
        {runs.data && runs.data.runs.length > 0 ? (
          <DataTable value={runs.data.runs} size="small" dataKey="id" loading={runs.loading} paginator rows={10} emptyMessage="No runs">
            <Column field="stage" header="Stage" />
            <Column header="Started" body={(run: RunRecord) => fromEpoch(run.started)} />
            <Column header="Duration" className="console-num" body={(run: RunRecord) => duration(run.started, run.ended)} />
            <Column header="Status" body={(run: RunRecord) => <Tag severity={statusSeverity(run.status)} value={run.status} />} />
            <Column header="Exit" className="console-num" body={(run: RunRecord) => (run.exit_code === null || run.exit_code === undefined ? DASH : String(run.exit_code))} />
            <Column header="Estimate" className="console-num" body={(run: RunRecord) => usd(run.estimate_usd)} />
            <Column header="Command" body={(run: RunRecord) => <code className="console-mono console-muted">{run.cmd}</code>} />
          </DataTable>
        ) : null}
      </section>
    </>
  )
}
