"""Neighborhood effects: what is happening on the doors around each door.

Providers cluster. A street where neighbours have recently moved in, pulled permits, or
have a crew on site is a street where word-of-mouth and crew presence already exist.
This module is pure computation over the already-harvested door records: it attaches a
``neighborhood`` dict to every door and never calls out to any service.

Neighbour counting uses a lat/lng grid whose cell edge equals the largest search radius,
so each door only compares against the 3x3 block of cells around it (O(n) for a
territory of a few hundred doors instead of O(n^2)).
"""
from math import asin, cos, floor, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000.0
CONF = 0.5                 # same detection gate as score.py
RECENT_MONTHS = 36         # "recent" for both deeds and permits
TRUCK_RADIUS_M = 200.0     # a crew on site is visible from further down the street


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = radians(lat1), radians(lat2)
    dphi = p2 - p1
    dlmb = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))


def _det(d: dict, key: str) -> bool:
    """True when a vision detection is present above the confidence gate.
    Mirrors score.py: detections on unusable imagery do not count."""
    v = d.get('vision') or {}
    s = v.get('signals') or {}
    if not s.get('image_usable'):
        return False
    det = s.get(key) or {}
    return bool(det.get('present')) and (det.get('confidence') or 0) >= CONF


def is_new_mover(d: dict) -> bool:
    m = d.get('months_since_deed')
    return bool(d.get('arms_length_sale')) and m is not None and m <= RECENT_MONTHS


def has_recent_permit(d: dict) -> bool:
    m = (d.get('permits') or {}).get('months_since_latest')
    return m is not None and m <= RECENT_MONTHS


def has_truck(d: dict) -> bool:
    return _det(d, 'provider_truck')


def has_renovation(d: dict) -> bool:
    return _det(d, 'renovation_activity') or bool((d.get('permits') or {}).get('major_project_5yr'))


class _Grid:
    """Bucket points by lat/lng cell so neighbour lookups only touch adjacent cells."""

    def __init__(self, doors: list[dict], cell_m: float):
        self.doors = doors
        # Degrees per cell, sized so a cell edge is at least ``cell_m`` on the ground.
        mean_lat = sum(d['lat'] for d in doors) / len(doors) if doors else 0.0
        self.dlat = cell_m / 111_320.0
        self.dlng = cell_m / max(111_320.0 * cos(radians(mean_lat)), 1e-9)
        self.cells: dict[tuple[int, int], list[int]] = {}
        for i, d in enumerate(doors):
            self.cells.setdefault(self._key(d['lat'], d['lng']), []).append(i)

    def _key(self, lat: float, lng: float) -> tuple[int, int]:
        return floor(lat / self.dlat), floor(lng / self.dlng)

    def candidates(self, lat: float, lng: float):
        r, c = self._key(lat, lng)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                yield from self.cells.get((r + dr, c + dc), ())


def _percentile_ranks(values: list[float]) -> list[int]:
    """0-100 rank of each value: share of other doors with a strictly lower value.
    Ties share a rank, so a territory where most doors show no activity leaves them all at 0."""
    n = len(values)
    if n < 2:
        return [0] * n
    ordered = sorted(values)
    below: dict[float, int] = {}
    for i, v in enumerate(ordered):
        below.setdefault(v, i)   # first index == count strictly below
    return [round(100 * below[v] / (n - 1)) for v in values]


def compute(doors: list[dict], radius_m: float = 150) -> list[dict]:
    """Attach ``d['neighborhood']`` to every door (in place) and return the list.

    Keys: n_within, new_movers_within, permits_within_3yr, trucks_within (200 m),
    renovations_within, activity_index, activity_pct.
    """
    if not doors:
        return doors
    scan_m = max(radius_m, TRUCK_RADIUS_M)
    grid = _Grid(doors, scan_m)
    movers = [is_new_mover(d) for d in doors]
    permits = [has_recent_permit(d) for d in doors]
    trucks = [has_truck(d) for d in doors]
    renos = [has_renovation(d) for d in doors]

    indices = []
    for i, d in enumerate(doors):
        n = nm = npm = ntr = nre = 0
        for j in grid.candidates(d['lat'], d['lng']):
            if j == i:
                continue
            o = doors[j]
            dist = haversine_m(d['lat'], d['lng'], o['lat'], o['lng'])
            if dist > scan_m:
                continue
            if dist <= TRUCK_RADIUS_M and trucks[j]:
                ntr += 1
            if dist <= radius_m:
                n += 1
                nm += movers[j]
                npm += permits[j]
                nre += renos[j]
        idx = round((nm + npm + 2 * ntr + nre) / max(n, 1), 3)
        indices.append(idx)
        d['neighborhood'] = {
            'radius_m': radius_m,
            'n_within': n,
            'new_movers_within': nm,
            'permits_within_3yr': npm,
            'trucks_within': ntr,
            'renovations_within': nre,
            'activity_index': idx,
        }
    for d, pct in zip(doors, _percentile_ranks(indices)):
        d['neighborhood']['activity_pct'] = pct
    return doors
