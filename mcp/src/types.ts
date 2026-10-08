export interface Signal {
  name: string
  icp_trait: string
  points: number
  max_points: number
  evidence: string
  source: string
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
