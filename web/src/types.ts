import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'

/**
 * One scoring signal. Only `name`, `points` and `max_points` are relied upon;
 * everything else is optional so future signals (e.g. vision signals with an
 * `image_url`) render without code changes.
 */
export interface Signal {
  name: string
  points: number
  max_points: number
  icp_trait?: string | null
  evidence?: string | null
  source?: string | null
  image_url?: string | null
}

export interface DoorProperties {
  door_id: string
  address: string
  municipality: string
  door_score: number
  rank: number
  tags: string[]
  signals: Signal[]
  year_built?: number | null
  home_age?: number | null
  lot_acres?: number | null
  net_value?: number | null
  deed_date?: string | null
  months_since_deed?: number | null
  sale_price?: number | null
  owner_occupied?: boolean | null
  stories?: number | null
  garage_bays?: number | null
}

export type DoorFeature = Feature<Point, DoorProperties>
export type DoorCollection = FeatureCollection<Point, DoorProperties>

export interface TerritoryProperties {
  name?: string
}

export type TerritoryCollection = FeatureCollection<Polygon | MultiPolygon, TerritoryProperties>

export const TAG_FILTERS = ['new mover', 'absentee owner', 'older home', 'long tenure'] as const
export type TagFilter = (typeof TAG_FILTERS)[number]

export const TOP_N_OPTIONS = [20, 50, 100, 'all'] as const
export type TopN = (typeof TOP_N_OPTIONS)[number]

/** Visibility state of a door after Top-N and tag filters are applied. */
export type DoorVisibility = 'active' | 'dim'
