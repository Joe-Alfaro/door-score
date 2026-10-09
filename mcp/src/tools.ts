import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { buildAddressIndex, type AddressLookup } from './address.js'
import { explainUrl, streetViewImageUrl } from './config.js'
import { parseLatLng } from './geo.js'
import { planRoute } from './route.js'
import { narrative, primaryTalkingPoint, talkingPoints } from './talking-points.js'
import { hasCoords, type Door, type LatLng, type Signal } from './types.js'

const ABSENTEE_TAG = 'absentee owner'

function jsonResult(payload: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError }
}

function notFound(lookup: AddressLookup, totalDoors: number): CallToolResult {
  const closest = lookup.candidates.map(({ door, score }) => ({ address: door.address, municipality: door.municipality, door_score: door.door_score, similarity: Math.round(score * 100) / 100 }))
  return jsonResult(
    {
      found: false,
      message: `No door matched "${lookup.normalizedQuery}" among ${totalDoors} doors. ${closest.length > 0 ? 'Closest candidates are listed; retry with one of them if it is the intended address.' : 'Try a street address like "107 E Ashgrove St".'}`,
      closest_candidates: closest,
    },
    true,
  )
}

function topSignals(door: Door, count: number) {
  return [...door.signals]
    .sort((a, b) => b.points - a.points)
    .slice(0, count)
    .map(({ name, evidence }) => ({ name, evidence }))
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0
  const position = (sortedAsc.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const lowerValue = sortedAsc[lower] ?? 0
  const upperValue = sortedAsc[upper] ?? lowerValue
  return Math.round((lowerValue + (upperValue - lowerValue) * (position - lower)) * 10) / 10
}

function streetView(door: Door) {
  const vision = door.vision
  if (!vision) return null
  return {
    image_url: streetViewImageUrl(door.door_id),
    date: vision.image.date,
    approximate: vision.image.approximate,
    distance_m: vision.image.distance_m,
    image_usable: vision.signals.image_usable,
    notes: vision.signals.notes ?? vision.signals.usability_note ?? null,
  }
}

function permitsSummary(door: Door) {
  const permits = door.permits
  if (!permits) return null
  return {
    permits_5yr: permits.permits_5yr,
    permits_10yr: permits.permits_10yr,
    cost_5yr: permits.cost_5yr,
    trades_5yr: permits.trades_5yr,
    latest: { date: permits.latest_date, type: permits.latest_type, cost: permits.latest_cost, months_ago: permits.months_since_latest },
    major_project_5yr: permits.major_project_5yr,
  }
}

function mean(values: number[]): number {
  return values.length > 0 ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100 : 0
}

function isVisionSignal(instances: Signal[]): boolean {
  return instances.some((signal) => /^street view/i.test(signal.source))
}

function normalizeTags(tags: string[] | undefined): string[] {
  return (tags ?? []).map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0)
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = key(item)
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
}

export function registerDoorTools(server: McpServer, doors: Door[]): void {
  const index = buildAddressIndex(doors)
  const totalDoors = doors.length
  const knownTags = [...new Set(doors.flatMap((door) => door.tags))].sort()
  const knownMunicipalities = [...new Set(doors.map((door) => door.municipality))].sort()

  server.registerTool(
    'get_door_score',
    {
      title: 'Get door score',
      description:
        'Look up the Door Score (0-100) for a single-family home in Ramsey/Allendale, NJ by street address. ' +
        'Input is matched fuzzily: case, punctuation, suffix spelling (Street/St, Avenue/Ave), directions (East/E) and a trailing city/state/zip are all tolerated, but the house number must match. ' +
        'Returns the score, territory rank, tags and the top 3 contributing signals. If nothing matches, returns up to 3 closest candidate addresses.',
      inputSchema: { address: z.string().min(1).describe('Street address, e.g. "107 E Ashgrove Street" or "107 E. Ashgrove St, Ramsey, NJ 07446"') },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ address }) => {
      const lookup = index.lookup(address)
      if (!lookup.match) return notFound(lookup, totalDoors)
      const { door, exact } = lookup.match
      return jsonResult({
        found: true,
        exact_match: exact,
        door_id: door.door_id,
        address: door.address,
        municipality: door.municipality,
        door_score: door.door_score,
        rank: door.rank,
        total_doors: totalDoors,
        tags: door.tags,
        top_signals: topSignals(door, 3),
      })
    },
  )

  server.registerTool(
    'explain_score',
    {
      title: 'Explain door score',
      description:
        'Full breakdown of why a home received its Door Score: every signal with points earned vs. maximum, evidence, data source and the ICP trait it maps to; ' +
        'a short plain-English narrative; and suggested talking points for a field rep at the door. Uses the same fuzzy address matching as get_door_score. ' +
        'The data contains no occupant identity and none is inferred.',
      inputSchema: { address: z.string().min(1).describe('Street address, e.g. "3 Larkwood Dr"') },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ address }) => {
      const lookup = index.lookup(address)
      if (!lookup.match) return notFound(lookup, totalDoors)
      const { door, exact } = lookup.match
      const signals = [...door.signals].sort((a, b) => b.points - a.points)
      return jsonResult({
        found: true,
        exact_match: exact,
        door_id: door.door_id,
        address: door.address,
        municipality: door.municipality,
        zip5: door.zip5,
        door_score: door.door_score,
        rank: door.rank,
        total_doors: totalDoors,
        tags: door.tags,
        points_earned: signals.reduce((sum, signal) => sum + signal.points, 0),
        points_possible: signals.reduce((sum, signal) => sum + signal.max_points, 0),
        signals: signals.map(({ name, icp_trait, points, max_points, evidence, source }) => ({ name, icp_trait, points, max_points, evidence, source })),
        property: {
          year_built: door.year_built,
          home_age: door.home_age,
          lot_acres: door.lot_acres,
          stories: door.stories,
          garage_bays: door.garage_bays,
          net_value: door.net_value,
          deed_date: door.deed_date,
          months_since_deed: door.months_since_deed,
          owner_occupied: door.owner_occupied,
        },
        street_view: streetView(door),
        permits: permitsSummary(door),
        census: door.census ?? null,
        narrative: narrative(door, totalDoors),
        talking_points: talkingPoints(door),
      })
    },
  )

  server.registerTool(
    'plan_route',
    {
      title: 'Plan a door-knocking route',
      description:
        'Build a walking route for a field rep within a time budget. Each door visit costs 6 minutes; walking is 5 km/h over straight-line (haversine) distance. ' +
        'Doors are chosen greedily by score per minute, then the order is tightened with a 2-opt pass. ' +
        'start_point may be an address in the dataset, a "lat,lng" string, or omitted (defaults to the highest-scoring eligible door). ' +
        'Doors tagged "absentee owner" are skipped unless include_absentee is true. Pass focus (a list of tags) to restrict eligible doors to those carrying at least one of them. ' +
        'Returns ordered stops with arrival minutes, a one-line talking point and an explain_url (map deep link) each, totals, and a Google Maps directions URL (first 10 stops).',
      inputSchema: {
        hours: z.number().positive().max(12).describe('Time budget in hours, e.g. 2 or 1.5'),
        start_point: z.string().optional().describe('Dataset address (e.g. "3 Larkwood Dr") or "lat,lng" (e.g. "41.0574,-74.1410"). Omit to start at the top-scoring door.'),
        max_doors: z.number().int().positive().max(200).optional().describe('Maximum stops (default 20)'),
        min_score: z.number().min(0).max(100).optional().describe('Only consider doors with door_score >= this (default 50)'),
        include_absentee: z.boolean().optional().describe('Include doors tagged "absentee owner" (default false)'),
        focus: z.array(z.string().min(1)).optional().describe(`Only doors carrying at least one of these tags (case-insensitive), e.g. ["new mover", "moving activity"]. Known tags: ${knownTags.join(', ')}`),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ hours, start_point, max_doors, min_score, include_absentee, focus }) => {
      const minScore = min_score ?? 50
      const maxDoors = max_doors ?? 20
      const focusTags = normalizeTags(focus)
      const unknownFocus = focusTags.filter((tag) => !knownTags.some((known) => known.toLowerCase() === tag))
      if (unknownFocus.length > 0) {
        return jsonResult({ error: `Unknown focus tag(s): ${unknownFocus.join(', ')}. Known tags: ${knownTags.join(', ')}` }, true)
      }
      const candidates = doors
        .filter(hasCoords)
        .filter((door) => door.door_score >= minScore)
        .filter((door) => include_absentee === true || !door.tags.includes(ABSENTEE_TAG))
        .filter((door) => focusTags.length === 0 || door.tags.some((tag) => focusTags.includes(tag.toLowerCase())))

      if (candidates.length === 0) {
        const focusNote = focusTags.length > 0 ? ` tagged ${focusTags.map((tag) => `"${tag}"`).join(' or ')}` : ''
        return jsonResult({ error: `No doors with door_score >= ${minScore}${focusNote}${include_absentee ? '' : ' (excluding absentee owners)'} have coordinates.` }, true)
      }

      const resolveStart = (): { start: LatLng; label: string } | CallToolResult => {
        if (start_point === undefined || start_point.trim() === '') {
          const top = candidates[0]
          if (!top) return jsonResult({ error: 'No eligible doors to start from.' }, true)
          return { start: { lat: top.lat, lng: top.lng }, label: `top-scoring door ${top.address}` }
        }
        const coords = parseLatLng(start_point)
        if (coords) return { start: coords, label: `coordinates ${coords.lat},${coords.lng}` }
        const lookup = index.lookup(start_point)
        if (!lookup.match) return notFound(lookup, totalDoors)
        const door = lookup.match.door
        if (!hasCoords(door)) return jsonResult({ error: `${door.address} has no coordinates; pass a "lat,lng" start_point instead.` }, true)
        return { start: { lat: door.lat, lng: door.lng }, label: door.address }
      }

      const resolved = resolveStart()
      if ('content' in resolved) return resolved

      const plan = planRoute(resolved.start, candidates, hours * 60, maxDoors)
      return jsonResult({
        start_point: { ...plan.start, label: resolved.label },
        budget_minutes: hours * 60,
        parameters: { min_score: minScore, max_doors: maxDoors, include_absentee: include_absentee === true, focus: focusTags, eligible_doors: candidates.length },
        stops: plan.stops.map((stop) => ({ ...stop, explain_url: explainUrl(stop.door_id) })),
        totals: plan.totals,
        google_maps_url: plan.google_maps_url,
      })
    },
  )

  server.registerTool(
    'list_top_doors',
    {
      title: 'List top doors',
      description: `The highest-scoring doors in the territory, optionally filtered to a tag and/or municipality. Known tags: ${knownTags.map((tag) => `"${tag}"`).join(', ')}. Municipalities: ${knownMunicipalities.join(', ')}. Returns address, municipality, score, rank, tags, coordinates and a one-line talking point per door.`,
      inputSchema: {
        n: z.number().int().positive().max(200).optional().describe('How many doors to return (default 20)'),
        tag: z.string().optional().describe(`Only doors carrying this tag (case-insensitive), e.g. "new mover"`),
        municipality: z.string().optional().describe(`Only doors in this municipality (case-insensitive), one of: ${knownMunicipalities.join(', ')}`),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ n, tag, municipality }) => {
      const limit = n ?? 20
      const wanted = tag?.trim().toLowerCase()
      const wantedMunicipality = municipality?.trim().toLowerCase()
      if (wantedMunicipality && !knownMunicipalities.some((known) => known.toLowerCase() === wantedMunicipality)) {
        return jsonResult({ error: `Unknown municipality "${municipality}". Known municipalities: ${knownMunicipalities.join(', ')}` }, true)
      }
      const filtered = doors
        .filter((door) => !wanted || door.tags.some((t) => t.toLowerCase() === wanted))
        .filter((door) => !wantedMunicipality || door.municipality.toLowerCase() === wantedMunicipality)
      if (wanted && filtered.length === 0) {
        return jsonResult({ error: `No doors carry tag "${tag}"${wantedMunicipality ? ` in ${municipality}` : ''}. Known tags: ${knownTags.join(', ')}` }, true)
      }
      return jsonResult({
        total_matching: filtered.length,
        tag: wanted ?? null,
        municipality: wantedMunicipality ?? null,
        doors: filtered.slice(0, limit).map((door) => ({
          address: door.address,
          municipality: door.municipality,
          door_score: door.door_score,
          rank: door.rank,
          tags: door.tags,
          lat: door.lat,
          lng: door.lng,
          talking_point: primaryTalkingPoint(door),
        })),
      })
    },
  )

  server.registerTool(
    'get_signal_summary',
    {
      title: 'Signal summary',
      description:
        'Per-signal coverage across every door: how many doors earned points, mean and max points, data sources, and for imagery-derived signals the share of carrying doors whose street-level image was usable. Takes no arguments.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => {
      const signalNames = [...new Set(doors.flatMap((door) => door.signals.map((signal) => signal.name)))]
      const summary = signalNames.map((name) => {
        const carrying = doors.filter((door) => door.signals.some((signal) => signal.name === name))
        const instances = carrying.flatMap((door) => door.signals.filter((signal) => signal.name === name))
        const scoring = instances.filter((signal) => signal.points > 0)
        const vision = isVisionSignal(instances)
        const usable = carrying.filter((door) => door.vision?.signals.image_usable === true).length
        return {
          name,
          icp_trait: instances[0]?.icp_trait ?? null,
          doors_with_signal: carrying.length,
          doors_with_points: scoring.length,
          share_with_points: carrying.length > 0 ? Math.round((scoring.length / carrying.length) * 1000) / 1000 : 0,
          mean_points: mean(instances.map((signal) => signal.points)),
          mean_points_when_scoring: mean(scoring.map((signal) => signal.points)),
          max_points: instances.reduce((top, signal) => Math.max(top, signal.max_points), 0),
          sources: [...new Set(instances.map((signal) => signal.source))],
          vision_signal: vision,
          usable_imagery_share: vision && carrying.length > 0 ? Math.round((usable / carrying.length) * 1000) / 1000 : null,
        }
      })
      const withVision = doors.filter((door) => door.vision)
      return jsonResult({
        doors: totalDoors,
        imagery: {
          doors_with_imagery: withVision.length,
          doors_with_usable_imagery: withVision.filter((door) => door.vision?.signals.image_usable === true).length,
        },
        doors_with_permits: doors.filter((door) => door.permits).length,
        doors_with_census: doors.filter((door) => door.census).length,
        signals: summary,
      })
    },
  )

  server.registerTool(
    'territory_stats',
    {
      title: 'Territory statistics',
      description: 'Summary of the whole scored territory: door count, score distribution (min/quartiles/max/mean), counts per tag, per-municipality breakdown and per-signal coverage. Takes no arguments.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => {
      const scores = doors.map((door) => door.door_score).sort((a, b) => a - b)
      const mean = scores.length > 0 ? Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10 : 0
      const byMunicipality = Object.entries(countBy(doors, (door) => door.municipality)).map(([municipality, count]) => {
        const subset = doors.filter((door) => door.municipality === municipality)
        return {
          municipality,
          doors: count,
          mean_score: Math.round((subset.reduce((sum, door) => sum + door.door_score, 0) / count) * 10) / 10,
          top_address: subset[0]?.address ?? null,
        }
      })
      const signalNames = [...new Set(doors.flatMap((door) => door.signals.map((signal) => signal.name)))]
      const signalCoverage = signalNames.map((name) => {
        const instances = doors.flatMap((door) => door.signals.filter((signal) => signal.name === name))
        const scoring = instances.filter((signal) => signal.points > 0)
        return {
          name,
          doors_with_points: scoring.length,
          mean_points: instances.length > 0 ? Math.round((instances.reduce((sum, s) => sum + s.points, 0) / instances.length) * 10) / 10 : 0,
          max_points: instances[0]?.max_points ?? null,
          sources: [...new Set(instances.map((signal) => signal.source))],
        }
      })
      return jsonResult({
        doors: totalDoors,
        score: { min: scores[0] ?? 0, q1: quantile(scores, 0.25), median: quantile(scores, 0.5), q3: quantile(scores, 0.75), max: scores[scores.length - 1] ?? 0, mean },
        score_buckets: {
          '80-100': scores.filter((s) => s >= 80).length,
          '60-79': scores.filter((s) => s >= 60 && s < 80).length,
          '40-59': scores.filter((s) => s >= 40 && s < 60).length,
          '0-39': scores.filter((s) => s < 40).length,
        },
        tags: countBy(doors.flatMap((door) => door.tags), (tag) => tag),
        municipalities: byMunicipality,
        signals: signalCoverage,
      })
    },
  )
}
