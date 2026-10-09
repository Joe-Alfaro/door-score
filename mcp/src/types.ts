export interface Signal {
  name: string
  icp_trait: string
  points: number
  max_points: number
  evidence: string
  source: string
}

export interface VisionDetection {
  present: boolean
  confidence: number
  evidence: string
  detail: string | null
}

/** Rating emitted by the imagery model: excellent | good | fair | poor | not_visible. */
export type ConditionRating = string

export interface VisionSignals {
  image_usable: boolean
  usability_note: string | null
  provider_truck: VisionDetection
  moving_indicators: VisionDetection
  yard_sign: VisionDetection
  renovation_activity: VisionDetection
  professional_landscaping: VisionDetection
  solar_panels: VisionDetection
  lawn_condition: ConditionRating
  exterior_condition: ConditionRating
  roof_condition: ConditionRating
  vehicles_visible: number
  notes: string | null
}

export interface VisionImage {
  date: string | null
  distance_m: number | null
  approximate: boolean
}

/** Street-level imagery assessment; null when no image was available for the door. */
export interface Vision {
  model: string
  signals: VisionSignals
  image: VisionImage
}

/** Construction-permit roll-up from the municipal permit record. */
export interface Permits {
  permits_10yr: number
  permits_5yr: number
  cost_5yr: number | null
  trades_5yr: string[]
  latest_date: string | null
  latest_type: string | null
  latest_cost: number | null
  months_since_latest: number | null
  major_project_5yr: boolean
}

/** Tract-level census profile (area statistics, never about one household). */
export interface Census {
  tract_geoid: string
  median_hh_income: number | null
  median_home_value?: number | null
  dual_earner_share: number | null
  owner_occupied_share: number | null
  moved_last_year_share: number | null
}

/**
 * One scored household. Only the fields the tools rely on are typed strictly;
 * extra pipeline columns are preserved via the index signature so future
 * fields do not break loading.
 */
export interface Door {
  door_id: string
  address: string
  address_raw: string
  municipality: string
  zip5: string | null
  lat: number | null
  lng: number | null
  door_score: number
  rank: number
  tags: string[]
  signals: Signal[]
  year_built: number | null
  home_age: number | null
  lot_acres: number | null
  net_value: number | null
  deed_date: string | null
  months_since_deed: number | null
  sale_price: number | null
  arms_length_sale: boolean | null
  owner_occupied: boolean | null
  owner_mailing_out_of_town: boolean | null
  stories: number | null
  garage_bays: number | null
  vision?: Vision | null
  permits?: Permits | null
  census?: Census | null
  [extra: string]: unknown
}

export interface LatLng {
  lat: number
  lng: number
}

export interface DoorWithCoords extends Door {
  lat: number
  lng: number
}

export function hasCoords(door: Door): door is DoorWithCoords {
  return typeof door.lat === 'number' && typeof door.lng === 'number' && Number.isFinite(door.lat) && Number.isFinite(door.lng)
}
