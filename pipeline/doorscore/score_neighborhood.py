"""Neighborhood-effects signal for the Door Score.

ICP trait: neighborhood effects. Providers cluster; a street where neighbours are moving in
and renovating is where word-of-mouth and crew presence already exist. Points are awarded
on the door's percentile within the territory (see neighborhood.compute), so the signal
always separates streets even in a quiet territory.

Integration: call ``neighborhood.compute(doors)`` once before scoring, then append
``signal_block_activity(d)`` to each door's signal list.
"""
from .score import Signal
from .neighborhood import TRUCK_RADIUS_M

NAME = 'block_activity'
TRAIT = 'neighborhood effects'
SOURCE = 'Derived (parcels + permits + imagery)'
MAX_POINTS = 6


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f'{n} {one if n == 1 else (many or one + "s")}'


def _points(pct: int) -> int:
    if pct >= 80:
        return 6
    if pct >= 60:
        return 4
    if pct >= 40:
        return 2
    return 0


def evidence_for(nb: dict) -> str:
    radius = nb.get('radius_m', 150)
    parts = [
        _plural(nb['new_movers_within'], 'recent mover'),
        f'{nb["permits_within_3yr"]} permits in 3 yrs' if nb['permits_within_3yr'] != 1 else '1 permit in 3 yrs',
        _plural(nb['renovations_within'], 'renovation'),
    ]
    if nb['trucks_within']:
        parts.append(_plural(nb['trucks_within'], 'provider truck') + f' within {TRUCK_RADIUS_M:.0f} m')
    pct = nb['activity_pct']
    standing = f'top {max(100 - pct, 1)}% of territory' if pct >= 50 else f'{pct}th percentile of territory'
    return f'Within {radius:.0f} m: ' + ', '.join(parts) + f' ({standing})'


def signal_block_activity(d: dict) -> Signal:
    nb = d.get('neighborhood')
    if nb is None:
        return Signal(NAME, TRAIT, 0, MAX_POINTS, 'Neighborhood not computed', SOURCE)
    if nb['n_within'] == 0:
        return Signal(NAME, TRAIT, 0, MAX_POINTS, f'No other doors within {nb.get("radius_m", 150):.0f} m', SOURCE)
    return Signal(NAME, TRAIT, _points(nb['activity_pct']), MAX_POINTS, evidence_for(nb), SOURCE)
