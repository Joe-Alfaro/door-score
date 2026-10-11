import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { useSearchParams } from 'react-router-dom'
import { EvidenceCard, MapView, StatsStrip, TerritoryBanner, TerritoryPanel, TopBar, useDrawPolygon } from './components'
import { DEFAULT_DATA_URLS, useDoorData } from './hooks'
import { computeStats, getTerritory, readStoredTerritory, storeTerritory, tagCounts, territoryDataUrls } from './lib'
import type { DoorFeature, DoorVisibility, TagFilter, TerritoryRecord, TopN } from './types'

export function App() {
  // The URL (`/?territory=<id>`) is the source of truth for the active custom territory, so the
  // share link and the post-score state are the same code path.
  const [searchParams, setSearchParams] = useSearchParams()
  const territoryId = searchParams.get('territory')
  const [territoryRecord, setTerritoryRecord] = useState<TerritoryRecord | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const draw = useDrawPolygon()
  const dataUrls = useMemo(() => (territoryId ? territoryDataUrls(territoryId) : DEFAULT_DATA_URLS), [territoryId])
  const { data, error, loading } = useDoorData(dataUrls)
  const mapRef = useRef<MapRef>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [topN, setTopN] = useState<TopN>('all')
  const [activeTags, setActiveTags] = useState<ReadonlySet<TagFilter>>(new Set())

  const doors = useMemo(() => data?.doors.features ?? [], [data])
  const stats = useMemo(() => computeStats(doors), [doors])
  const tagOptions = useMemo(() => tagCounts(doors), [doors])

  // Tag filters hide non-matching doors (a door passes if it carries ANY active
  // tag); Top-N keeps everything visible but dims doors ranked below N.
  const visibility = useMemo(() => {
    const limit = topN === 'all' ? Number.POSITIVE_INFINITY : topN
    const entries = doors
      .filter((door) => activeTags.size === 0 || door.properties.tags.some((tag) => activeTags.has(tag)))
      .map((door) => {
        const state: DoorVisibility = door.properties.rank <= limit ? 'active' : 'dim'
        return [door.properties.door_id, state] as const
      })
    return new Map<string, DoorVisibility>(entries)
  }, [doors, topN, activeTags])

  const visibleCount = useMemo(
    () => [...visibility.values()].filter((state) => state === 'active').length,
    [visibility],
  )

  const selectedDoor = useMemo(
    () => doors.find((door) => door.properties.door_id === selectedId) ?? null,
    [doors, selectedId],
  )

  const toggleTag = useCallback((tag: TagFilter) => {
    setActiveTags((previous) => {
      const next = new Set(previous)
      if (next.has(tag)) {
        next.delete(tag)
      } else {
        next.add(tag)
      }
      return next
    })
  }, [])

  const pickDoor = useCallback((door: DoorFeature) => {
    setSelectedId(door.properties.door_id)
    const [lng, lat] = door.geometry.coordinates
    if (lng === undefined || lat === undefined) return
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 900 })
  }, [])

  // Deep-linked territories arrive without a record; fetch it for the name. Failure is cosmetic.
  useEffect(() => {
    if (!territoryId || territoryRecord?.territory_id === territoryId) return
    let cancelled = false
    getTerritory(territoryId)
      .then((record) => {
        if (!cancelled) setTerritoryRecord(record)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [territoryId, territoryRecord])

  // Filters and selection belong to one data set; reset them when the territory swaps.
  useEffect(() => {
    setSelectedId(null)
    setActiveTags(new Set())
  }, [territoryId])

  // A custom territory sticks until "Back to default": fill the URL from storage when a link
  // arrives without it, and remember whatever the URL says.
  useEffect(() => {
    if (territoryId) {
      storeTerritory(territoryId)
      return
    }
    const stored = readStoredTerritory()
    if (stored) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous)
        next.set('territory', stored)
        return next
      })
    }
  }, [territoryId, setSearchParams])

  const activateTerritory = useCallback(
    (record: TerritoryRecord) => {
      setTerritoryRecord(record)
      setPanelOpen(false)
      storeTerritory(record.territory_id)
      setSearchParams({ territory: record.territory_id })
    },
    [setSearchParams],
  )

  const backToDefault = useCallback(() => {
    storeTerritory(null)
    setTerritoryRecord(null)
    setSearchParams({})
  }, [setSearchParams])

  const imageryCount = useMemo(() => doors.filter((door) => door.properties.vision != null).length, [doors])

  // Deep link: /?door=<door_id> (emitted by the MCP server's explain_url) opens that door's card.
  useEffect(() => {
    if (doors.length === 0) return
    const wanted = new URLSearchParams(window.location.search).get('door')
    const door = wanted ? doors.find((d) => d.properties.door_id === wanted) : undefined
    if (!door) return
    setSelectedId(door.properties.door_id)
    const timer = window.setTimeout(() => pickDoor(door), 1200)
    return () => window.clearTimeout(timer)
  }, [doors, pickDoor])

  if (error) {
    return (
      <div className="app-message">
        <div>
          <strong>Could not load data.</strong> {error}
          {territoryId ? (
            <div className="app-message-actions">
              <button type="button" className="btn" onClick={backToDefault}>
                Back to default
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (!data) {
    return <div className="app-message muted">Loading doors…</div>
  }

  return (
    <div className="app">
      <TopBar
        doors={doors}
        tags={tagOptions}
        topN={topN}
        onTopNChange={setTopN}
        activeTags={activeTags}
        onToggleTag={toggleTag}
        onPickDoor={pickDoor}
        territoryOpen={panelOpen}
        onToggleTerritory={() => setPanelOpen((open) => !open)}
      />
      <StatsStrip stats={stats} visibleCount={visibleCount} />
      <main className="main">
        <MapView
          mapRef={mapRef}
          doors={data.doors}
          territory={data.territory}
          visibility={visibility}
          selectedId={selectedId}
          onSelect={setSelectedId}
          drawing={draw.drawing}
          draft={draw.draft}
          onDrawClick={draw.addPoint}
        >
          <div className="map-overlays">
            {territoryId ? (
              <TerritoryBanner
                territoryId={territoryId}
                name={territoryRecord?.territory_id === territoryId ? (territoryRecord.name ?? null) : null}
                total={stats.count}
                withImagery={imageryCount}
                loading={loading}
                onBack={backToDefault}
              />
            ) : null}
            {panelOpen ? (
              <TerritoryPanel
                draw={draw}
                onScored={activateTerritory}
                onClose={() => {
                  draw.clear()
                  setPanelOpen(false)
                }}
              />
            ) : null}
          </div>
        </MapView>
        {selectedDoor ? (
          <EvidenceCard door={selectedDoor} total={stats.count} onClose={() => setSelectedId(null)} />
        ) : null}
      </main>
    </div>
  )
}
