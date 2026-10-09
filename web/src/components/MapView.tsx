import { useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { Layer, Map, NavigationControl, Popup, Source } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre'
import type { LayerProps } from 'react-map-gl/maplibre'
import type { StyleSpecification } from 'maplibre-gl'
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
}

const DOOR_LAYER_ID = 'doors-circle'

// Free CARTO Positron raster basemap; no API key required.
const BASEMAP: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: ['a', 'b', 'c', 'd'].map(
        (subdomain) => `https://${subdomain}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`,
      ),
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
}

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

export function MapView({ mapRef, doors, territory, visibility, selectedId, onSelect }: MapViewProps) {
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
    const door = doorFromEvent(event)
    if (!door) {
      setHover(null)
      return
    }
    const [lng, lat] = door.geometry.coordinates
    setHover({ door, lng: lng ?? event.lngLat.lng, lat: lat ?? event.lngLat.lat })
  }

  function handleClick(event: MapLayerMouseEvent) {
    const door = doorFromEvent(event)
    onSelect(door ? door.properties.door_id : null)
  }

  return (
    <div className="map-wrap">
      <Map
        ref={mapRef}
        mapStyle={BASEMAP}
        initialViewState={bounds ? { bounds, fitBoundsOptions: { padding: 48 } } : { longitude: -74.14, latitude: 41.06, zoom: 13 }}
        interactiveLayerIds={[DOOR_LAYER_ID]}
        cursor={hover ? 'pointer' : 'grab'}
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
    </div>
  )
}
