/** Shapes returned by the console FastAPI backend. Null-heavy on purpose: most enrichment is optional. */

export interface Health {
  ok: boolean
  doors: number
}

export interface CostProduction {
  model: string
  usd: number
  doors: number
  usd_per_door: number
}

export interface CostSummary {
  total_usd: number
  by_stage: Record<string, number>
  by_model: Record<string, number>
  production?: CostProduction | null
  eval_and_discovery_usd?: number | null
}

export interface RunReport {
  parcels_in_polygon?: number | null
  single_family_homes?: number | null
  pct_with_address?: number | null
  pct_with_deed_date?: number | null
  pct_with_year_built?: number | null
  pct_with_assessed_value?: number | null
  pct_owner_occupancy_resolved?: number | null
  pct_building_desc_parsed?: number | null
  absentee_owners?: number | null
  new_movers_36mo?: number | null
  doors_with_imagery?: number | null
  doors_with_usable_imagery?: number | null
  doors_with_usable_satellite?: number | null
  doors_with_permit_history?: number | null
  cost?: CostSummary | null
}

export interface Territory {
  name?: string | null
  target_homes?: number | null
  sfh_count?: number | null
}

export interface KeyStatus {
  anthropic: boolean
  google: boolean
  census: boolean
}

export interface Deployment {
  url: string
  ok: boolean
  status: number | string
  ms: number | null
}

export interface Status {
  report: RunReport
  cost: CostSummary
  territory: Territory | null
  keys: KeyStatus
  deployments: Record<string, Deployment>
  doors_file_mtime: number | null
  /** Spend cap enforced by the backend for paid stages. */
  max_spend_usd?: number | null
  auth?: string | null
}

export interface DoorSummary {
  door_id: string
  address: string
  municipality: string
  door_score: number
  door_score_pct?: number | null
  rank: number
  tags: string[]
  year_built?: number | null
  lot_acres?: number | null
  net_value?: number | null
  deed_date?: string | null
  months_since_deed?: number | null
  owner_occupied?: boolean | null
  lat?: number | null
  lng?: number | null
}

export interface DoorsPage {
  total: number
  doors: DoorSummary[]
}

export interface DoorsQuery {
  limit?: number
  offset?: number
  tag?: string
  q?: string
  sort?: string
  order?: 'asc' | 'desc'
  municipality?: string
}

export interface Signal {
  name: string
  icp_trait?: string | null
  points: number
  max_points: number
  evidence?: string | null
  source?: string | null
}

export interface VisionFlag {
  present: boolean
  confidence?: number | null
  evidence?: string | null
  detail?: string | null
}

/** Vision signal maps mix flags, ratings (strings), counts and notes; narrow at the call site. */
export type VisionSignalValue = VisionFlag | string | number | boolean | null | undefined

export interface VisionBlock {
  model?: string | null
  prompt_version?: string | null
  usd?: number | null
  signals?: Record<string, VisionSignalValue> | null
  image?: Record<string, string | number | boolean | null> | null
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
  median_home_value?: number | null
  dual_earner_share?: number | null
  owner_occupied_share?: number | null
  moved_last_year_share?: number | null
}

export interface Neighborhood {
  radius_m?: number | null
  n_within?: number | null
  new_movers_within?: number | null
  permits_within_3yr?: number | null
  trucks_within?: number | null
  renovations_within?: number | null
  activity_index?: number | null
  activity_pct?: number | null
}

export interface DoorDetail extends DoorSummary {
  signals?: Signal[] | null
  vision?: VisionBlock | null
  satellite?: VisionBlock | null
  permits?: Permits | null
  census?: Census | null
  neighborhood?: Neighborhood | null
  home_age?: number | null
  stories?: number | null
  garage_bays?: number | null
  sale_price?: number | null
  zip5?: string | null
  block?: string | null
  lot?: string | null
}

export interface TagCount {
  tag: string
  count: number
}

export interface SourceProbe {
  reachable?: boolean | null
  status?: number | string | null
}

export interface DataSource {
  name: string
  publisher?: string | null
  url?: string | null
  data_type?: string | null
  access?: string | null
  fields?: string[] | null
  join_key?: string | null
  tos_ok?: boolean | null
  tos_note?: string | null
  pii_risk?: string | null
  icp_use?: string | null
  probe?: SourceProbe | null
}

export interface SourcesResponse {
  territory?: string | null
  runs?: number | null
  usd?: number | null
  summary?: string | null
  wired_in_pipeline?: string[] | null
  sources: DataSource[]
}

export interface BinaryMetrics {
  tp: number
  fp: number
  fn: number
  tn?: number
  precision: number | null
  recall: number | null
  f1: number | null
  hallucination_rate?: number | null
  support_pos?: number
}

export interface RatingMetrics {
  n: number
  exact_agreement: number | null
  within_one_step: number | null
}

export type SignalMetrics = BinaryMetrics | RatingMetrics

export interface ModelEval {
  model: string
  conf_threshold?: number | null
  n_labeled?: number | null
  signals: Record<string, SignalMetrics>
  threshold_sweep?: Record<string, Record<string, BinaryMetrics>> | null
  usability_false_positive_rate?: number | null
  top_signal?: string | null
  cost?: CostSummary | null
}

export const BINARY_LABEL_KEYS = [
  'provider_truck',
  'moving_indicators',
  'yard_sign',
  'renovation_activity',
  'professional_landscaping',
  'solar_panels',
] as const

export const RATING_LABEL_KEYS = ['lawn_condition', 'exterior_condition', 'roof_condition'] as const

export type BinaryLabelKey = (typeof BINARY_LABEL_KEYS)[number]
export type RatingLabelKey = (typeof RATING_LABEL_KEYS)[number]

export interface EvalLabel extends Partial<Record<BinaryLabelKey, boolean | null>>, Partial<Record<RatingLabelKey, string | null>> {
  door_id: string
  image?: string | null
  image_usable?: boolean | null
  verified_by_human?: boolean | null
  labeler?: string | null
  note?: string | null
}

export interface EvalResponse {
  results: Record<string, ModelEval>
  labels: EvalLabel[]
  n_verified: number
}

export interface LedgerRow {
  ts: number
  stage: string
  door_id?: string | null
  usd: number
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
}

export interface LedgerResponse {
  rows: LedgerRow[]
  total_rows?: number
}

export interface Stage {
  id: string
  title: string
  description: string
  cmd: string[]
  paid: boolean
  estimate_usd: number
  needs: string[]
  cache: Record<string, number>
  accepts_limit?: boolean
}

export interface StagesResponse {
  stages: Stage[]
  active_run: string | null
  max_spend_usd?: number | null
  spent_usd?: number | null
}

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | string

export interface RunRecord {
  id: string
  stage: string
  cmd: string
  started: number
  ended?: number | null
  status: RunStatus
  exit_code?: number | null
  estimate_usd?: number | null
}

export interface RunWithLog extends RunRecord {
  log_tail: string[]
}

export interface RunRequestBody {
  limit?: number
  confirm_paid?: boolean
}

export interface RunsResponse {
  runs: RunRecord[]
}

export type StreamEvent = { line: string } | { done: true; status: RunStatus; exit_code: number | null }

export interface RouteRequest {
  hours: number
  start_point?: string
  min_score?: number
  max_doors?: number
  focus?: string[]
}

export interface RouteStop {
  order: number
  address: string
  door_score: number
  lat?: number | null
  lng?: number | null
  walk_minutes_from_previous?: number | null
  arrive_minute?: number | null
  talking_point?: string | null
  explain_url?: string | null
}

export interface RouteTotals {
  doors: number
  total_minutes: number
  walking_minutes: number
  total_score: number
}

export interface RoutePlan {
  stops: RouteStop[]
  totals: RouteTotals
  google_maps_url?: string | null
}

export interface McpTool {
  name: string
  description?: string | null
  inputSchema?: Record<string, unknown>
}

export interface McpToolsResponse {
  tools?: McpTool[]
}
