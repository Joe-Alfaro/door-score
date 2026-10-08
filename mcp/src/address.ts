import type { Door } from './types.js'

const SUFFIXES: Record<string, string> = {
  STREET: 'ST',
  STR: 'ST',
  AVENUE: 'AVE',
  AV: 'AVE',
  DRIVE: 'DR',
  DRV: 'DR',
  ROAD: 'RD',
  COURT: 'CT',
  CRT: 'CT',
  PLACE: 'PL',
  LANE: 'LN',
  LA: 'LN',
  TERRACE: 'TER',
  TERR: 'TER',
  CIRCLE: 'CIR',
  BOULEVARD: 'BLVD',
  HIGHWAY: 'HWY',
  PARKWAY: 'PKWY',
  TRAIL: 'TRL',
  WAY: 'WAY',
  PATH: 'PATH',
  SQUARE: 'SQ',
  TURNPIKE: 'TPKE',
  EXTENSION: 'EXT',
}

const DIRECTIONS: Record<string, string> = {
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
}

// Tokens that belong to the city/state/zip tail rather than the street address.
const TAIL_TOKENS = new Set(['RAMSEY', 'ALLENDALE', 'NJ', 'NEW', 'JERSEY', 'USA', 'US', 'BERGEN', 'COUNTY'])
const UNIT_TOKENS = new Set(['APT', 'UNIT', 'SUITE', 'STE', 'FL', 'FLOOR'])

/**
 * Canonicalize a free-form address so that "107 E. Ashgrove Street, Ramsey, NJ 07446"
 * and "107 E ASHGROVE ST" normalize to the same string.
 */
export function normalizeAddress(input: string): string {
  // Everything after the first comma is treated as city/state/zip.
  const streetPart = input.split(',')[0] ?? ''
  const tokens = streetPart
    .toUpperCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
    // A 5- or 9-digit token is a zip code unless it is the leading house number.
    .filter((token, index) => index === 0 || !/^\d{5}(\d{4})?$/.test(token))
    .map((token) => SUFFIXES[token] ?? DIRECTIONS[token] ?? token)

  // Drop city/state tail tokens that appear after the street name without a comma,
  // and drop unit designators plus whatever follows them.
  const unitIndex = tokens.findIndex((token) => UNIT_TOKENS.has(token))
  const withoutUnit = unitIndex === -1 ? tokens : tokens.slice(0, unitIndex)
  const trimmed = dropTrailingTail(withoutUnit)
  return trimmed.join(' ')
}

function dropTrailingTail(tokens: string[]): string[] {
  const reversed = [...tokens].reverse()
  const firstKeepIndex = reversed.findIndex((token) => !TAIL_TOKENS.has(token))
  if (firstKeepIndex <= 0) return tokens
  return tokens.slice(0, tokens.length - firstKeepIndex)
}

export function houseNumber(normalized: string): string | undefined {
  const first = normalized.split(' ')[0]
  return first && /^\d+[A-Z]?$/.test(first) ? first : undefined
}

export interface AddressMatch {
  door: Door
  exact: boolean
  score: number
}

export interface AddressLookup {
  match?: AddressMatch
  candidates: AddressMatch[]
  normalizedQuery: string
}

interface IndexedDoor {
  door: Door
  normalized: string
  tokens: Set<string>
  house: string | undefined
}

export interface AddressIndex {
  lookup(query: string): AddressLookup
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((token) => b.has(token)).length
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : shared / union
}

/**
 * Builds a reusable fuzzy index. Exact match on the normalized address wins; otherwise
 * the best token-overlap match among doors sharing the same house number is returned
 * (a mismatched house number is never treated as a match).
 */
export function buildAddressIndex(doors: Door[]): AddressIndex {
  const indexed: IndexedDoor[] = doors.map((door) => {
    const normalized = normalizeAddress(door.address)
    return { door, normalized, tokens: new Set(normalized.split(' ')), house: houseNumber(normalized) }
  })
  const byNormalized = new Map(indexed.map((entry) => [entry.normalized, entry]))

  return {
    lookup(query: string): AddressLookup {
      const normalizedQuery = normalizeAddress(query)
      const exact = byNormalized.get(normalizedQuery)
      if (exact) {
        return { match: { door: exact.door, exact: true, score: 1 }, candidates: [], normalizedQuery }
      }

      const queryTokens = new Set(normalizedQuery.split(' '))
      const queryHouse = houseNumber(normalizedQuery)
      const ranked = indexed
        .map((entry) => ({ door: entry.door, exact: false, score: tokenOverlap(queryTokens, entry.tokens), house: entry.house }))
        .sort((a, b) => b.score - a.score)

      const sameHouse = ranked.filter((entry) => queryHouse !== undefined && entry.house === queryHouse)
      const best = sameHouse[0]
      // Require at least one shared token beyond the house number to call it a match.
      const isMatch = best !== undefined && best.score > 0 && [...queryTokens].filter((token) => token !== queryHouse).some((token) => normalizeAddress(best.door.address).split(' ').includes(token))
      const candidates = (sameHouse.length > 0 ? sameHouse : ranked)
        .slice(0, 3)
        .map(({ door, exact: isExact, score }) => ({ door, exact: isExact, score }))

      if (isMatch) {
        return { match: { door: best.door, exact: false, score: best.score }, candidates, normalizedQuery }
      }
      return { candidates, normalizedQuery }
    },
  }
}
