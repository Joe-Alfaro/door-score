import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { buildAddressIndex, type AddressLookup } from './address.js'
import { parseLatLng } from './geo.js'
import { planRoute } from './route.js'
import { narrative, primaryTalkingPoint, talkingPoints } from './talking-points.js'
import { hasCoords, type Door, type LatLng } from './types.js'

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
        'Doors tagged "absentee owner" are skipped unless include_absentee is true. Returns ordered stops with arrival minutes and a one-line talking point each, totals, and a Google Maps directions URL (first 10 stops).',
      inputSchema: {
        hours: z.number().positive().max(12).describe('Time budget in hours, e.g. 2 or 1.5'),
        start_point: z.string().optional().describe('Dataset address (e.g. "3 Larkwood Dr") or "lat,lng" (e.g. "41.0574,-74.1410"). Omit to start at the top-scoring door.'),
        max_doors: z.number().int().positive().max(200).optional().describe('Maximum stops (default 20)'),
        min_score: z.number().min(0).max(100).optional().describe('Only consider doors with door_score >= this (default 50)'),
        include_absentee: z.boolean().optional().describe('Include doors tagged "absentee owner" (default false)'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ hours, start_point, max_doors, min_score, include_absentee }) => {
      const minScore = min_score ?? 50
      const maxDoors = max_doors ?? 20
      const candidates = doors
        .filter(hasCoords)
        .filter((door) => door.door_score >= minScore)
        .filter((door) => include_absentee === true || !door.tags.includes(ABSENTEE_TAG))

      if (candidates.length === 0) {
        return jsonResult({ error: `No doors with door_score >= ${minScore}${include_absentee ? '' : ' (excluding absentee owners)'} have coordinates.` }, true)
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
        parameters: { min_score: minScore, max_doors: maxDoors, include_absentee: include_absentee === true, eligible_doors: candidates.length },
        stops: plan.stops,
        totals: plan.totals,
        google_maps_url: plan.google_maps_url,
      })
    },
  )

  server.registerTool(
    'list_top_doors',
    {
      title: 'List top doors',
      description: `The highest-scoring doors in the territory, optionally filtered to a tag. Known tags: ${knownTags.map((tag) => `"${tag}"`).join(', ')}. Returns address, municipality, score, rank, tags, coordinates and a one-line talking point per door.`,
      inputSchema: {
        n: z.number().int().positive().max(200).optional().describe('How many doors to return (default 20)'),
        tag: z.string().optional().describe(`Only doors carrying this tag (case-insensitive), e.g. "new mover"`),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ n, tag }) => {
      const limit = n ?? 20
      const wanted = tag?.trim().toLowerCase()
      const filtered = wanted ? doors.filter((door) => door.tags.some((t) => t.toLowerCase() === wanted)) : doors
      if (wanted && filtered.length === 0) {
        return jsonResult({ error: `No doors carry tag "${tag}". Known tags: ${knownTags.join(', ')}` }, true)
      }
      return jsonResult({
        total_matching: filtered.length,
        tag: wanted ?? null,
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
