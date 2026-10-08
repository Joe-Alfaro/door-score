import type { Door, Signal } from './types.js'

/**
 * Field-rep guidance derived purely from property/transaction signals.
 * Nothing here refers to, or infers, the identity of an occupant.
 */

const KNOWN_SIGNAL_POINTS: Record<string, (door: Door, signal: Signal) => string | undefined> = {
  new_mover: (door, signal) =>
    signal.points > 0
      ? `Welcome to the neighborhood; ask which home services they are still setting up${describeMonthsSinceDeed(door)}.`
      : undefined,
  maintenance_demand: (door, signal) =>
    signal.points > 0
      ? `Older home${door.year_built ? ` (built ${door.year_built})` : ''}: ask about roof, HVAC and water-heater age and whether anything is due for replacement.`
      : undefined,
  lawn_demand: (door, signal) =>
    signal.points > 0
      ? `${door.lot_acres ? `${door.lot_acres} acre` : 'Large'} lot: lead with lawn care, landscaping and seasonal cleanup.`
      : undefined,
  hires_out_capacity: (_door, signal) =>
    signal.points >= signal.max_points && signal.max_points > 0
      ? 'Higher-value home: position a premium or bundled service plan rather than a one-off job.'
      : undefined,
  household_size_proxy: (_door, signal) =>
    signal.points >= signal.max_points * 0.75 && signal.max_points > 0
      ? 'Likely a busy multi-person household: emphasize convenience, scheduling flexibility and recurring service.'
      : undefined,
  owner_occupied: (door, signal) =>
    signal.points === 0 || door.owner_mailing_out_of_town === true
      ? 'Tax mailing address is elsewhere: likely a rental. Ask for the owner or property manager contact, or skip.'
      : undefined,
  provider_truck: (_door, signal) =>
    `A service provider was observed at this address (${signal.source}): ask how satisfied they are with their current provider.`,
}

function describeMonthsSinceDeed(door: Door): string {
  return typeof door.months_since_deed === 'number' ? ` (moved in about ${door.months_since_deed} months ago)` : ''
}

function genericSignalPoint(signal: Signal): string | undefined {
  if (signal.points <= 0) return undefined
  return `${humanize(signal.name)} noted (${signal.source}): ${signal.evidence}.`
}

function humanize(name: string): string {
  const words = name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function tagPoints(door: Door): string[] {
  const points: string[] = []
  if (door.tags.includes('long tenure')) {
    points.push('Long-time owner: ask what has not been updated in a while and offer a maintenance checkup.')
  }
  if (door.tags.includes('absentee owner') && door.owner_mailing_out_of_town !== true) {
    points.push('Flagged as absentee owner: likely a rental. Ask for the owner or property manager contact, or skip.')
  }
  return points
}

/** Ordered, de-duplicated talking points. Strongest signal first. */
export function talkingPoints(door: Door): string[] {
  const bySignal = [...door.signals]
    .sort((a, b) => b.points - a.points)
    .map((signal) => {
      const known = KNOWN_SIGNAL_POINTS[signal.name]
      return known ? known(door, signal) : genericSignalPoint(signal)
    })
    .filter((point): point is string => typeof point === 'string')

  const combined = [...bySignal, ...tagPoints(door)]
  const unique = combined.filter((point, index) => combined.indexOf(point) === index)
  return unique.length > 0 ? unique : ['No strong signals: lead with a general home-services introduction and a seasonal offer.']
}

/** The single most relevant line, used for route stops. */
export function primaryTalkingPoint(door: Door): string {
  const absentee = door.tags.includes('absentee owner') || door.owner_mailing_out_of_town === true
  const points = talkingPoints(door)
  if (absentee) {
    return points.find((point) => point.toLowerCase().includes('rental')) ?? points[0] ?? ''
  }
  return points[0] ?? ''
}

/** Template-based 2-3 sentence summary of why the door scored as it did. */
export function narrative(door: Door, totalDoors: number): string {
  const sorted = [...door.signals].sort((a, b) => b.points - a.points)
  const strongest = sorted.filter((signal) => signal.points > 0).slice(0, 2)
  const weakest = sorted.filter((signal) => signal.points < signal.max_points).slice(-1)[0]

  const first = `${titleCase(door.address)} in ${door.municipality} scores ${door.door_score}/100 and ranks #${door.rank} of ${totalDoors} doors in the territory.`
  const second =
    strongest.length > 0
      ? `The score is driven mainly by ${strongest.map((signal) => `${humanize(signal.name).toLowerCase()} (${lowerFirst(signal.evidence)})`).join(' and ')}.`
      : 'No individual signal contributed points, so the score reflects baseline territory fit only.'
  const third = weakest
    ? `The biggest gap is ${humanize(weakest.name).toLowerCase()}, which earned ${weakest.points} of ${weakest.max_points} possible points.`
    : 'Every signal scored its maximum, so there is no obvious weak spot.'
  return [first, second, third].join(' ')
}

const DIRECTION_TOKENS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])

function titleCase(address: string): string {
  return address
    .split(' ')
    .map((token) => (DIRECTION_TOKENS.has(token) ? token : token.charAt(0) + token.slice(1).toLowerCase()))
    .join(' ')
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
