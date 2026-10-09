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

/** A yes/no observation the vision model made about the Street View frame. */
export interface VisionFlag {
  present: boolean
  confidence?: number | null
  evidence?: string | null
  detail?: string | null
}

export interface VisionSignals {
  image_usable: boolean
  usability_note?: string | null
  provider_truck?: VisionFlag | null
  moving_indicators?: VisionFlag | null
  yard_sign?: VisionFlag | null
  renovation_activity?: VisionFlag | null
  professional_landscaping?: VisionFlag | null
  solar_panels?: VisionFlag | null
  lawn_condition?: string | null
  exterior_condition?: string | null
  roof_condition?: string | null
  vehicles_visible?: number | null
  notes?: string | null
}

export interface VisionImage {
  /** Absolute path on the pipeline machine; the app derives the URL from `door_id` instead. */
  path?: string | null
  /** Capture month, e.g. `2025-07`. */
  date?: string | null
  pano_id?: string | null
  pano_lat?: number | null
  pano_lng?: number | null
  distance_m?: number | null
  /** True when the nearest pano was far enough from the lot that the frame may not show it. */
  approximate?: boolean | null
}

export interface Vision {
  model?: string | null
  prompt_version?: string | null
  usd?: number | null
  signals?: VisionSignals | null
  image?: VisionImage | null
}

export interface Permits {
  permits_10yr?: number | null
  permits_5yr?: number | null
  cost_5yr?: number | null
  trades_5yr?: string[] | null
  latest_date?: string | null
  latest_type?: string | null
  latest_cost?: number | null
  months_since_latest?: number | null
  major_project_5yr?: boolean | null
}

export interface Census {
  tract_geoid?: string | null
  median_hh_income?: number | null
  dual_earner_share?: number | null
  owner_occupied_share?: number | null
  moved_last_year_share?: number | null
  median_home_value?: number | null
}

export interface DoorProperties {
  door_id: string
  address: string
  municipality: string
  door_score: number
  door_score_pct?: number | null
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
  vision?: Vision | null
  permits?: Permits | null
  census?: Census | null
}

export type DoorFeature = Feature<Point, DoorProperties>
export type DoorCollection = FeatureCollection<Point, DoorProperties>

export interface TerritoryProperties {
  name?: string
}

export type TerritoryCollection = FeatureCollection<Polygon | MultiPolygon, TerritoryProperties>

/** Tags are whatever the pipeline emits; the filter set is derived from the loaded data. */
export type TagFilter = string

export interface TagCount {
  tag: TagFilter
  count: number
}

export const TOP_N_OPTIONS = [20, 50, 100, 'all'] as const
export type TopN = (typeof TOP_N_OPTIONS)[number]

/** Visibility state of a door after Top-N and tag filters are applied. */
export type DoorVisibility = 'active' | 'dim'
