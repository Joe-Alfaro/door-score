import { useCallback, useMemo, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { EvidenceCard, MapView, StatsStrip, TopBar } from './components'
import { useDoorData } from './hooks'
import { computeStats, tagCounts } from './lib'
import type { DoorFeature, DoorVisibility, TagFilter, TopN } from './types'

export function App() {
  const { data, error } = useDoorData()
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

  if (error) {
    return (
      <div className="app-message">
        <strong>Could not load data.</strong> {error}
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
        />
        {selectedDoor ? (
          <EvidenceCard door={selectedDoor} total={stats.count} onClose={() => setSelectedId(null)} />
        ) : null}
      </main>
    </div>
  )
}
