import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson'
import { Layer, Map, NavigationControl, Popup, Source } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre'
import type { LayerProps } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { SCORE_COLOR_EXPRESSION, territoryBounds } from '../lib'
import type { DoorCollection, DoorFeature, DoorVisibility, TerritoryCollection } from '../types'
import { Legend } from './Legend'

interface MapViewProps {
  mapRef: RefObject<MapRef>
  doors: DoorCollection
  territory: TerritoryCollection
  visibility: ReadonlyMap<string, DoorVisibility>
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Custom-territory drawing: while true, clicks add vertices instead of selecting doors. */
  drawing?: boolean
  draft?: FeatureCollection<Point | LineString | Polygon> | null
  onDrawClick?: (point: readonly [number, number]) => void
  /** Overlays (custom-territory banner and panel) positioned over the map, not the evidence card. */
  children?: ReactNode
}

const DOOR_LAYER_ID = 'doors-circle'

// Keyless vector basemap. CARTO's raster tiles started returning "API KEY REQUIRED" for
// non-localhost origins; OpenFreeMap serves an equivalent Positron style with no key.
const BASEMAP = 'https://tiles.openfreemap.org/styles/positron'

const territoryFill: LayerProps = {
  id: 'territory-fill',
  type: 'fill',
  paint: { 'fill-color': '#256abf', 'fill-opacity': 0.04 },
}

const territoryLine: LayerProps = {
  id: 'territory-line',
  type: 'line',
  paint: { 'line-color': '#256abf', 'line-width': 2, 'line-dasharray': [2, 2] },
}

const draftFill: LayerProps = {
  id: 'draft-fill',
  type: 'fill',
  filter: ['==', ['geometry-type'], 'Polygon'],
  paint: { 'fill-color': '#d9772b', 'fill-opacity': 0.12 },
}

const draftLine: LayerProps = {
  id: 'draft-line',
  type: 'line',
  filter: ['==', ['geometry-type'], 'LineString'],
  paint: { 'line-color': '#d9772b', 'line-width': 2 },
}

const draftVertices: LayerProps = {
  id: 'draft-vertices',
  type: 'circle',
  filter: ['==', ['geometry-type'], 'Point'],
  paint: { 'circle-color': '#ffffff', 'circle-radius': 5, 'circle-stroke-color': '#d9772b', 'circle-stroke-width': 2 },
}

const EMPTY_DRAFT: FeatureCollection<Point | LineString | Polygon> = { type: 'FeatureCollection', features: [] }

const doorCircles: LayerProps = {
  id: DOOR_LAYER_ID,
  type: 'circle',
  paint: {
    'circle-color': SCORE_COLOR_EXPRESSION,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 6, 17, 10],
    'circle-opacity': ['case', ['==', ['get', 'vis'], 'dim'], 0.15, 0.9],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': ['case', ['==', ['get', 'vis'], 'dim'], 0, 1],
    'circle-stroke-opacity': 0.9,
  },
}

interface HoverState {
  door: DoorFeature
  lng: number
  lat: number
}

export function MapView({
  mapRef,
  doors,
  territory,
  visibility,
  selectedId,
  onSelect,
  drawing = false,
  draft = null,
  onDrawClick,
  children,
}: MapViewProps) {
  const [hover, setHover] = useState<HoverState | null>(null)

  const byId = useMemo(
    () => new window.Map(doors.features.map((door) => [door.properties.door_id, door] as const)),
    [doors],
  )

  // Features with nested arrays come back from the map as JSON strings, so the
  // rendered source carries only the scalar fields the style needs; rich data is
  // looked up from `byId` on hover/click.
  const renderedDoors = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: doors.features
        .filter((door) => visibility.has(door.properties.door_id))
        .map((door) => ({
          type: 'Feature',
          geometry: door.geometry,
          properties: {
            door_id: door.properties.door_id,
            door_score: door.properties.door_score,
            door_score_pct: door.properties.door_score_pct ?? door.properties.door_score,
            vis: visibility.get(door.properties.door_id) ?? 'active',
          },
        })),
    }),
    [doors, visibility],
  )

  const bounds = useMemo(() => territoryBounds(territory), [territory])

  // The initial view comes from `initialViewState`; refit only when the territory is swapped later.
  const firstBounds = useRef(true)
  useEffect(() => {
    if (firstBounds.current) {
      firstBounds.current = false
      return
    }
    if (!bounds) return
    mapRef.current?.fitBounds(bounds, { padding: 48, duration: 800 })
  }, [bounds, mapRef])

  const selectedLayer = useMemo<LayerProps>(
    () => ({
      id: 'doors-selected',
      type: 'circle',
      filter: ['==', ['get', 'door_id'], selectedId ?? ''],
      paint: {
        'circle-color': SCORE_COLOR_EXPRESSION,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 14, 10, 17, 14],
        'circle-stroke-color': '#1a1a1a',
        'circle-stroke-width': 2,
      },
    }),
    [selectedId],
  )

  function doorFromEvent(event: MapLayerMouseEvent): DoorFeature | null {
    const feature = event.features?.[0]
    const id = feature?.properties?.door_id
    if (typeof id !== 'string') return null
    return byId.get(id) ?? null
  }

  function handleMouseMove(event: MapLayerMouseEvent) {
    const door = drawing ? null : doorFromEvent(event)
    if (!door) {
      setHover(null)
      return
    }
    const [lng, lat] = door.geometry.coordinates
    setHover({ door, lng: lng ?? event.lngLat.lng, lat: lat ?? event.lngLat.lat })
  }

  function handleClick(event: MapLayerMouseEvent) {
    if (drawing) {
      onDrawClick?.([event.lngLat.lng, event.lngLat.lat])
      return
    }
    const door = doorFromEvent(event)
    onSelect(door ? door.properties.door_id : null)
  }

  const cursor = drawing ? 'crosshair' : hover ? 'pointer' : 'grab'

  return (
    <div className="map-wrap">
      <Map
        ref={mapRef}
        mapStyle={BASEMAP}
        initialViewState={bounds ? { bounds, fitBoundsOptions: { padding: 48 } } : { longitude: -74.14, latitude: 41.06, zoom: 13 }}
        interactiveLayerIds={[DOOR_LAYER_ID]}
        cursor={cursor}
        doubleClickZoom={!drawing}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        onClick={handleClick}
        attributionControl={{ compact: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" showCompass={false} />

        <Source id="territory" type="geojson" data={territory}>
          <Layer {...territoryFill} />
          <Layer {...territoryLine} />
        </Source>

        <Source id="doors" type="geojson" data={renderedDoors}>
          <Layer {...doorCircles} />
          <Layer {...selectedLayer} />
        </Source>

        <Source id="draft" type="geojson" data={draft ?? EMPTY_DRAFT}>
          <Layer {...draftFill} />
          <Layer {...draftLine} />
          <Layer {...draftVertices} />
        </Source>

        {hover ? (
          <Popup
            longitude={hover.lng}
            latitude={hover.lat}
            closeButton={false}
            closeOnClick={false}
            offset={10}
            className="hover-popup"
          >
            <div className="popup-address">{hover.door.properties.address}</div>
            <div className="muted">
              Score {hover.door.properties.door_score} · #{hover.door.properties.rank}
              {typeof hover.door.properties.door_score_pct === 'number' ? ` · ${hover.door.properties.door_score_pct}th pct` : ''}
            </div>
          </Popup>
        ) : null}
      </Map>
      <Legend />
      {children}
    </div>
  )
}
