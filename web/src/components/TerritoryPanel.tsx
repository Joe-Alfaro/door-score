import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson'
import { TerritoryApiError, parseTerritoryInput, polygonFromRing, startTerritory, waitForTerritory } from '../lib'
import type { TerritoryInput, TerritoryRecord } from '../types'

export type LngLat = readonly [number, number]

export interface DrawPolygonState {
  /** True while map clicks add vertices. */
  drawing: boolean
  points: LngLat[]
  /** Set once "Finish" closed a ring of at least three vertices. */
  finished: boolean
  /** In-progress ring for rendering on the map: vertices, the connecting line and a preview fill. */
  draft: FeatureCollection<Point | LineString | Polygon> | null
  start: () => void
  addPoint: (point: LngLat) => void
  finish: () => void
  clear: () => void
}

const MIN_VERTICES = 3

/** Click-to-add-vertex polygon drawing; the map owns the click events, this owns the ring. */
export function useDrawPolygon(): DrawPolygonState {
  const [drawing, setDrawing] = useState(false)
  const [finished, setFinished] = useState(false)
  const [points, setPoints] = useState<LngLat[]>([])

  const start = useCallback(() => {
    setPoints([])
    setFinished(false)
    setDrawing(true)
  }, [])

  const addPoint = useCallback((point: LngLat) => {
    setPoints((previous) => [...previous, point])
  }, [])

  const canFinish = points.length >= MIN_VERTICES
  const finish = useCallback(() => {
    if (!canFinish) return
    setFinished(true)
    setDrawing(false)
  }, [canFinish])

  const clear = useCallback(() => {
    setPoints([])
    setFinished(false)
    setDrawing(false)
  }, [])

  const draft = useMemo<DrawPolygonState['draft']>(() => {
    if (points.length === 0) return null
    const vertices: Feature<Point>[] = points.map(([lng, lat], index) => ({
      type: 'Feature',
      properties: { index },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    }))
    const first = points[0]
    const outline = finished && first ? [...points, first] : points
    const line: Feature<LineString>[] =
      points.length >= 2
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: outline.map(([lng, lat]) => [lng, lat]) },
            },
          ]
        : []
    const fill: Feature<Polygon>[] = points.length >= MIN_VERTICES ? [polygonFromRing(points)] : []
    return { type: 'FeatureCollection', features: [...fill, ...line, ...vertices] }
  }, [points, finished])

  return { drawing, points, finished, draft, start, addPoint, finish, clear }
}

type InputMode = 'draw' | 'paste'

interface SubmitState {
  phase: 'idle' | 'submitting' | 'running' | 'error'
  message: string | null
  logTail: string[]
}

const IDLE: SubmitState = { phase: 'idle', message: null, logTail: [] }

interface TerritoryPanelProps {
  draw: DrawPolygonState
  /** Called with the finished record once the backend reports `succeeded`. */
  onScored: (record: TerritoryRecord) => void
  onClose: () => void
}

function describeError(reason: unknown): string {
  if (reason instanceof TerritoryApiError) return reason.message
  if (reason instanceof DOMException && reason.name === 'AbortError') return 'Cancelled.'
  if (reason instanceof Error) return reason.message
  return 'Something went wrong; please try again.'
}

export function TerritoryPanel({ draw, onScored, onClose }: TerritoryPanelProps) {
  const [mode, setMode] = useState<InputMode>('draw')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [submit, setSubmit] = useState<SubmitState>(IDLE)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const busy = submit.phase === 'submitting' || submit.phase === 'running'
  const drawReady = draw.finished && draw.points.length >= MIN_VERTICES
  const canScore = !busy && (mode === 'draw' ? drawReady : text.trim().length > 0)

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    file
      .text()
      .then((contents) => {
        setText(contents)
        setSubmit(IDLE)
      })
      .catch(() => setSubmit({ phase: 'error', message: `Could not read ${file.name}.`, logTail: [] }))
  }

  function buildInput(): TerritoryInput {
    if (mode === 'draw') {
      if (!drawReady) throw new Error(`Draw at least ${MIN_VERTICES} points and press Finish.`)
      return polygonFromRing(draw.points)
    }
    return parseTerritoryInput(text)
  }

  async function score() {
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    try {
      const geojson = buildInput()
      setSubmit({ phase: 'submitting', message: 'Submitting polygon…', logTail: [] })
      const started = await startTerritory(geojson, name)
      setSubmit({ phase: 'running', message: null, logTail: [] })
      const record = await waitForTerritory(
        started.territory_id,
        (update) => {
          if (controller.signal.aborted) return
          setSubmit({ phase: 'running', message: null, logTail: update.log_tail.slice(-3) })
        },
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (record.status !== 'succeeded') {
        const last = record.log_tail.at(-1)
        setSubmit({
          phase: 'error',
          message: `Scoring ${record.status}${last ? `: ${last}` : '.'}`,
          logTail: record.log_tail.slice(-3),
        })
        return
      }
      setSubmit(IDLE)
      draw.clear()
      onScored(record)
    } catch (reason: unknown) {
      if (controller.signal.aborted) return
      setSubmit({ phase: 'error', message: describeError(reason), logTail: [] })
    }
  }

  return (
    <section className="territory-panel" aria-label="Score your own polygon">
      <div className="panel-header">
        <strong>Territory</strong>
        <button type="button" className="close panel-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'draw'}
          className={mode === 'draw' ? 'panel-tab panel-tab-active' : 'panel-tab'}
          onClick={() => setMode('draw')}
        >
          Draw on map
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'paste'}
          className={mode === 'paste' ? 'panel-tab panel-tab-active' : 'panel-tab'}
          onClick={() => setMode('paste')}
        >
          Paste or upload GeoJSON
        </button>
      </div>

      {mode === 'draw' ? (
        <div className="panel-body">
          <p className="muted panel-help">
            {draw.drawing
              ? `Click the map to add vertices (${draw.points.length} so far). Finish needs at least ${MIN_VERTICES}.`
              : draw.finished
                ? `Polygon with ${draw.points.length} vertices ready.`
                : 'Start drawing, then click the map once per corner.'}
          </p>
          <div className="panel-actions">
            {draw.drawing ? (
              <button type="button" className="btn btn-primary" disabled={draw.points.length < MIN_VERTICES} onClick={draw.finish}>
                Finish
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={draw.start}>
                {draw.finished ? 'Redraw' : 'Draw'}
              </button>
            )}
            <button type="button" className="btn" disabled={draw.points.length === 0 || busy} onClick={draw.clear}>
              Clear
            </button>
          </div>
        </div>
      ) : (
        <div className="panel-body">
          <textarea
            className="panel-textarea"
            placeholder='{"type": "Polygon", "coordinates": [[[lng, lat], …]]}'
            aria-label="GeoJSON polygon"
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
          />
          <label className="panel-file">
            <span className="muted">or upload</span>
            <input type="file" accept=".geojson,.json,application/geo+json,application/json" disabled={busy} onChange={handleFile} />
          </label>
        </div>
      )}

      <label className="panel-name">
        <span className="control-label">Name (optional)</span>
        <input
          type="text"
          value={name}
          disabled={busy}
          placeholder="e.g. North side pilot"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <button type="button" className="btn btn-primary panel-submit" disabled={!canScore} onClick={() => void score()}>
        {busy ? 'Scoring…' : 'Score this territory'}
      </button>

      {submit.phase === 'submitting' && submit.message ? <p className="muted panel-help">{submit.message}</p> : null}
      {submit.phase === 'running' ? (
        <pre className="panel-log" aria-live="polite">
          {submit.logTail.length > 0 ? submit.logTail.join('\n') : 'Scoring from public records…'}
        </pre>
      ) : null}
      {submit.phase === 'error' ? (
        <p className="panel-error" role="alert">
          {submit.message}
        </p>
      ) : null}
    </section>
  )
}
