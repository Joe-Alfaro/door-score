import { useState } from 'react'
import { AutoComplete } from 'primereact/autocomplete'
import type { AutoCompleteCompleteEvent } from 'primereact/autocomplete'
import { Button } from 'primereact/button'
import { Card } from 'primereact/card'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { InputNumber } from 'primereact/inputnumber'
import { MultiSelect } from 'primereact/multiselect'
import { Slider } from 'primereact/slider'
import { getDoors, getTags, isRecord, planRoute } from '../api'
import { EmptyState, ErrorPanel, PageHeader, StatCard, useToast } from '../components'
import { DASH, num, text } from '../format'
import { errorMessage, useApi } from '../hooks'
import type { DoorSummary, RoutePlan, RouteRequest, RouteStop } from '../types'

type StartValue = string | DoorSummary

function toStartValue(value: unknown): StartValue {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.address === 'string' && typeof value.door_id === 'string') return value as unknown as DoorSummary
  return ''
}

function startAddress(value: StartValue): string | undefined {
  const address = typeof value === 'string' ? value.trim() : value.address
  return address.length > 0 ? address : undefined
}

export function RoutePage() {
  const toast = useToast()
  const tags = useApi(() => getTags().catch(() => []), [])
  const [hours, setHours] = useState(2)
  const [start, setStart] = useState<StartValue>('')
  const [suggestions, setSuggestions] = useState<DoorSummary[]>([])
  const [minScore, setMinScore] = useState<number | null>(50)
  const [maxDoors, setMaxDoors] = useState<number | null>(20)
  const [focus, setFocus] = useState<string[]>([])
  const [plan, setPlan] = useState<RoutePlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  async function complete(event: AutoCompleteCompleteEvent) {
    try {
      const page = await getDoors({ q: event.query, limit: 8, sort: 'rank' })
      setSuggestions(page.doors)
    } catch {
      setSuggestions([])
    }
  }

  async function submit() {
    const body: RouteRequest = {
      hours,
      ...(startAddress(start) ? { start_point: startAddress(start) } : {}),
      ...(minScore !== null ? { min_score: minScore } : {}),
      ...(maxDoors !== null ? { max_doors: maxDoors } : {}),
      ...(focus.length > 0 ? { focus } : {}),
    }
    setPlanning(true)
    setPlanError(null)
    try {
      const result = await planRoute(body)
      setPlan(result)
      if (result.stops.length === 0) toast({ severity: 'warn', summary: 'Empty route', detail: 'No doors satisfied the constraints.' })
    } catch (reason) {
      const message = errorMessage(reason)
      setPlanError(message)
      toast({ severity: 'error', summary: 'Route planning failed', detail: message, life: 8000 })
    } finally {
      setPlanning(false)
    }
  }

  return (
    <>
      <PageHeader title="Route planner" subtitle="Asks the MCP server for a walking plan over the highest-scoring doors." />

      <Card>
        <div className="console-form">
          <div className="console-field">
            <label htmlFor="route-hours">Hours on the street: {hours.toFixed(1)}</label>
            <Slider id="route-hours" value={hours} min={0.5} max={8} step={0.5} onChange={(event) => setHours(typeof event.value === 'number' ? event.value : (event.value[0] ?? hours))} style={{ marginTop: 10 }} />
          </div>
          <div className="console-field">
            <label htmlFor="route-start">Start address</label>
            <AutoComplete inputId="route-start" value={start} suggestions={suggestions} completeMethod={(event) => void complete(event)} field="address" onChange={(event) => setStart(toStartValue(event.value))} placeholder="Optional; defaults to the best door" itemTemplate={(door: DoorSummary) => `${door.address} · #${door.rank}`} />
          </div>
          <div className="console-field">
            <label htmlFor="route-min">Minimum Door Score</label>
            <InputNumber inputId="route-min" value={minScore} min={0} max={100} onValueChange={(event) => setMinScore(event.value ?? null)} />
          </div>
          <div className="console-field">
            <label htmlFor="route-max">Max doors</label>
            <InputNumber inputId="route-max" value={maxDoors} min={1} max={200} onValueChange={(event) => setMaxDoors(event.value ?? null)} />
          </div>
          <div className="console-field">
            <label htmlFor="route-focus">Focus tags</label>
            <MultiSelect inputId="route-focus" value={focus} options={(tags.data ?? []).map((entry) => entry.tag)} onChange={(event) => setFocus(Array.isArray(event.value) ? event.value.filter((value): value is string => typeof value === 'string') : [])} placeholder="Any" display="chip" loading={tags.loading} />
          </div>
        </div>
        <div className="console-stage-actions">
          <Button label="Plan route" icon="pi pi-directions" loading={planning} onClick={() => void submit()} />
          {plan?.google_maps_url ? <Button label="Open in Google Maps" icon="pi pi-external-link" outlined onClick={() => window.open(plan.google_maps_url ?? '', '_blank', 'noopener')} /> : null}
        </div>
      </Card>

      {planError && !plan ? (
        <div className="console-section">
          <ErrorPanel message={planError} />
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="console-grid console-grid-stats console-section">
            <StatCard label="Doors" value={num(plan.totals.doors)} />
            <StatCard label="Total minutes" value={num(plan.totals.total_minutes)} />
            <StatCard label="Walking minutes" value={num(plan.totals.walking_minutes)} />
            <StatCard label="Total score" value={num(plan.totals.total_score)} />
          </div>
          <section className="console-section">
            {plan.stops.length === 0 ? (
              <EmptyState icon="pi pi-directions" title="No stops in this plan" hint="Lower the minimum score or widen the focus." />
            ) : (
              <DataTable value={plan.stops} dataKey="order" size="small" emptyMessage="No stops">
                <Column field="order" header="#" className="console-num" style={{ width: 50 }} />
                <Column header="Address" body={(stop: RouteStop) => (stop.explain_url ? <a href={stop.explain_url} target="_blank" rel="noreferrer">{stop.address}</a> : stop.address)} />
                <Column field="door_score" header="Score" className="console-num" style={{ width: 80 }} />
                <Column header="Walk (min)" className="console-num" body={(stop: RouteStop) => num(stop.walk_minutes_from_previous)} />
                <Column header="Arrive (min)" className="console-num" body={(stop: RouteStop) => (stop.arrive_minute === null || stop.arrive_minute === undefined ? DASH : num(stop.arrive_minute))} />
                <Column header="Talking point" body={(stop: RouteStop) => text(stop.talking_point)} />
              </DataTable>
            )}
          </section>
        </>
      ) : null}
    </>
  )
}
