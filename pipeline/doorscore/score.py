"""Door Score: fuse per-door signals into 0-100 with traceable evidence.

ICP (see docs/door-score-rationale.md): an owner-occupied single-family household that
has recently moved or is entering a high-maintenance phase, with the means to hire out.
Every signal below names the ICP trait it is evidence for.
"""
from dataclasses import dataclass, asdict
from statistics import quantiles

@dataclass
class Signal:
    name: str
    icp_trait: str
    points: float
    max_points: float
    evidence: str
    source: str

def _pct_rank(value, cutpoints) -> int:
    """0..len(cutpoints) quartile-style rank."""
    return sum(value >= c for c in cutpoints)

def signal_new_mover(d: dict) -> Signal:
    m, arms = d['months_since_deed'], d['arms_length_sale']
    mx = 25
    if m is None:
        return Signal('new_mover', 'recently moved', 0, mx, 'No deed date on record', 'NJ MOD-IV')
    if m <= 12: pts = 25
    elif m <= 36: pts = 18
    elif m <= 60: pts = 8
    else: pts = 0
    note = f'Deed dated {d["deed_date"]} ({m} months ago)'
    if arms is False:
        pts *= 0.5
        note += '; nominal price suggests a transfer, not a purchase'
    elif arms and pts:
        note += f'; purchased for ${d["sale_price"]:,}'
    return Signal('new_mover', 'recently moved', pts, mx, note, 'NJ MOD-IV')

def signal_capacity(d: dict, value_cuts) -> Signal:
    mx = 15
    v = d['net_value']
    if not v:
        return Signal('hires_out_capacity', 'means to hire out', 0, mx, 'No assessed value', 'NJ MOD-IV')
    q = _pct_rank(v, value_cuts)  # 0..3
    pts = [0, 5, 10, 15][q]
    label = ['bottom quartile', 'second quartile', 'third quartile', 'top quartile'][q]
    return Signal('hires_out_capacity', 'means to hire out', pts, mx,
                  f'Assessed value ${v:,} is in the {label} for this territory', 'NJ MOD-IV')

def signal_owner_occupied(d: dict) -> Signal:
    mx = 10
    if d['owner_occupied'] is None:
        return Signal('owner_occupied', 'homeowner relationship', 5, mx, 'Owner occupancy unknown (no mailing address)', 'NJ MOD-IV')
    if d['owner_occupied']:
        return Signal('owner_occupied', 'homeowner relationship', 10, mx, 'Owner-occupied (tax mailing address is the property)', 'NJ MOD-IV')
    where = 'out of town' if d['owner_mailing_out_of_town'] else 'elsewhere in town'
    return Signal('owner_occupied', 'homeowner relationship', 0, mx, f'Absentee owner: tax bills mailed {where}', 'NJ MOD-IV')

def signal_maintenance(d: dict) -> Signal:
    mx = 10
    age = d['home_age']
    if age is None:
        return Signal('maintenance_demand', 'needs services', 0, mx, 'Year built unknown', 'NJ MOD-IV')
    if age >= 40: pts = 10
    elif age >= 25: pts = 7
    elif age >= 10: pts = 4
    else: pts = 0
    return Signal('maintenance_demand', 'needs services', pts, mx, f'Built {d["year_built"]} ({age} years old)', 'NJ MOD-IV')

def signal_lawn(d: dict) -> Signal:
    mx = 8
    ac = d['lot_acres'] or 0
    pts = 8 if ac >= 0.4 else 5 if ac >= 0.25 else 2
    return Signal('lawn_demand', 'needs services', pts, mx, f'{ac:.2f} acre lot', 'NJ MOD-IV')

def signal_household(d: dict) -> Signal:
    mx = 8
    big = (d['stories'] or 0) >= 2
    gar = (d['garage_bays'] or 0) >= 2
    pts = 8 if big and gar else 4 if (big or gar) else 0
    desc = []
    if d['stories']: desc.append(f'{d["stories"]}-story')
    if d['garage_bays'] is not None: desc.append(f'{d["garage_bays"]}-car garage')
    return Signal('household_size_proxy', 'busy multi-person household', pts, mx,
                  ', '.join(desc) or 'Building description unavailable', 'NJ MOD-IV')

def score_doors(doors: list[dict]) -> list[dict]:
    values = [d['net_value'] for d in doors if d['net_value']]
    cuts = quantiles(values, n=4) if len(values) >= 4 else [0, 0, 0]
    any_vision = any(d.get('vision') for d in doors)
    any_census = any(d.get('census') for d in doors)
    any_permits = any(d.get('permits') for d in doors)
    out = []
    for d in doors:
        sigs = [signal_new_mover(d), signal_capacity(d, cuts), signal_owner_occupied(d),
                signal_maintenance(d), signal_lawn(d), signal_household(d)]
        if any_vision:
            sigs += [fn(d) for fn in VISION_SIGNALS]
        if any_census:
            sigs.append(signal_dual_income_area(d))
        if any_permits:
            sigs.append(signal_permits(d))
        # Doors without usable imagery are scored on the data signals only, so a missing
        # photo never penalizes a door relative to its neighbors.
        got = sum(s.points for s in sigs)
        mx = sum(s.max_points for s in sigs if not (s.source == 'Street View' and s.evidence == 'No usable street imagery'))
        score = round(100 * got / mx) if mx else 0
        d = dict(d)
        d['door_score'] = score
        d['signals'] = [asdict(s) for s in sigs]
        d['tags'] = tags_for(d, sigs)
        out.append(d)
    out.sort(key=lambda x: -x['door_score'])
    for i, d in enumerate(out, 1):
        d['rank'] = i
    return out

def tags_for(d: dict, sigs: list[Signal]) -> list[str]:
    t = []
    if (d['months_since_deed'] or 999) <= 36 and d['arms_length_sale']: t.append('new mover')
    if d['owner_occupied'] is False: t.append('absentee owner')
    if (d['months_since_deed'] or 0) >= 240: t.append('long tenure')
    if (d['home_age'] or 0) >= 60: t.append('older home')
    names = {s.name: s for s in sigs}
    if names.get('provider_truck') and names['provider_truck'].points > 0: t.append('provider on site')
    if names.get('moving_indicators') and names['moving_indicators'].points > 0: t.append('moving activity')
    if (d.get('permits') or {}).get('major_project_5yr'): t.append('recent major project')
    if names.get('visible_service_need') and names['visible_service_need'].points >= 6: t.append('visible wear')
    return t


# ---- Vision-derived signals (Street View) ---------------------------------------------
# Each maps a visual observation to an ICP trait. Confidence gates keep hallucinations out
# of the score: a detection below the threshold contributes nothing.
CONF = 0.5   # set from the eval threshold sweep on 98 verified images (see docs/test-results.md)

def _vis(d: dict) -> dict | None:
    v = d.get('vision')
    if not v or not v.get('signals', {}).get('image_usable'):
        return None
    return v

def _src(d: dict) -> str:
    img = (d.get('vision') or {}).get('image', {})
    date = img.get('date') or 'undated'
    approx = ' (camera ~%dm from lot center)' % img['distance_m'] if img.get('approximate') else ''
    return f'Street View {date}{approx}'

def signal_provider_truck(d: dict) -> Signal:
    mx = 8
    v = _vis(d)
    if not v:
        return Signal('provider_truck', 'hires out', 0, mx, 'No usable street imagery', 'Street View')
    det = v['signals']['provider_truck']
    if det['present'] and det['confidence'] >= CONF:
        what = det.get('detail') or 'service vehicle'
        return Signal('provider_truck', 'hires out', mx, mx, f'Provider truck on site ({what}): {det["evidence"]}', _src(d))
    return Signal('provider_truck', 'hires out', 0, mx, 'No provider vehicle visible', _src(d))

def signal_yard_sign(d: dict) -> Signal:
    """A contractor / landscaper / security-company lawn sign is a receipt for hiring out.
    Small weight: eval precision was 0.50 on the production model (n=6 positives).
    professional_landscaping was removed from the score after failing its eval (see docs/test-results.md)."""
    mx = 3
    v = _vis(d)
    if not v:
        return Signal('yard_sign', 'hires out', 0, mx, 'No usable street imagery', 'Street View')
    sign = v['signals']['yard_sign']
    if sign['present'] and sign['confidence'] >= CONF:
        return Signal('yard_sign', 'hires out', mx, mx, f'Yard sign ({sign.get("detail") or "unspecified"}): {sign["evidence"]}', _src(d))
    return Signal('yard_sign', 'hires out', 0, mx, 'No yard sign visible', _src(d))

def signal_condition(d: dict) -> Signal:
    """Visible wear = near-term service demand (roof, exterior, lawn). Pristine = already maintained."""
    mx = 6
    v = _vis(d)
    if not v:
        return Signal('visible_service_need', 'needs services', 0, mx, 'No usable street imagery', 'Street View')
    s = v['signals']
    worn = [k for k in ('lawn_condition', 'exterior_condition', 'roof_condition') if s[k] in ('poor', 'fair')]
    reno = s['renovation_activity']
    if reno['present'] and reno['confidence'] >= CONF:
        return Signal('visible_service_need', 'needs services', mx, mx, f'Active renovation: {reno["evidence"]}', _src(d))
    if len(worn) >= 2:
        return Signal('visible_service_need', 'needs services', mx, mx, f'Wear visible: {", ".join(w.replace("_condition", "") for w in worn)}', _src(d))
    if len(worn) == 1:
        return Signal('visible_service_need', 'needs services', 3, mx, f'Some wear: {worn[0].replace("_condition", "")} rated {s[worn[0]]}', _src(d))
    return Signal('visible_service_need', 'needs services', 0, mx, 'Exterior, lawn and roof look well kept', _src(d))

def signal_moving(d: dict) -> Signal:
    """A PODS container or moving truck in dated imagery is direct, door-specific new-mover evidence
    that can predate the deed record by months."""
    mx = 10
    v = _vis(d)
    if not v:
        return Signal('moving_indicators', 'recently moved', 0, mx, 'No usable street imagery', 'Street View')
    det = v['signals'].get('moving_indicators') or {'present': False, 'confidence': 0}
    if det['present'] and det['confidence'] >= CONF:
        return Signal('moving_indicators', 'recently moved', mx, mx, f'Moving activity ({det.get("detail") or "container/truck"}): {det["evidence"]}', _src(d))
    return Signal('moving_indicators', 'recently moved', 0, mx, 'No moving activity visible', _src(d))

VISION_SIGNALS = [signal_provider_truck, signal_moving, signal_yard_sign, signal_condition]


# ---- Permit history (NJ DCA construction permits, joined on block/lot) ------------------
def signal_permits(d: dict) -> Signal:
    """Permitted work is contractor work. Recent or repeated permits show a household that
    hires out and is actively investing in the home."""
    mx = 8
    p = d.get('permits')
    if not p or not p['permits_10yr']:
        return Signal('permit_history', 'hires out', 0, mx, 'No construction permits in the last 10 years', 'NJ DCA permits')
    pts = 0
    if p['months_since_latest'] is not None and p['months_since_latest'] <= 36: pts += 4
    if p['permits_5yr'] >= 2: pts += 2
    if p['major_project_5yr']: pts += 2
    pts = min(pts, mx)
    ev = f'{p["permits_5yr"]} permit(s) in 5 yrs, latest {p["latest_type"].lower() if p["latest_type"] else "work"} {p["latest_date"]}'
    if p['cost_5yr']: ev += f', ${p["cost_5yr"]:,} declared'
    if p['trades_5yr']: ev += f' ({", ".join(p["trades_5yr"])})'
    return Signal('permit_history', 'hires out', pts, mx, ev, 'NJ DCA permits')


# ---- Neighborhood prior (Census ACS, tract level, aggregate only) ---------------------
def signal_dual_income_area(d: dict) -> Signal:
    """The ICP's 'busy dual-income household' cannot be read off a parcel; the tract-level share of
    two-parent families where both parents work is the closest public, non-identifying proxy."""
    mx = 6
    c = d.get('census')
    if not c or c.get('dual_earner_share') is None:
        return Signal('dual_income_area', 'busy dual-income household', 0, mx, 'No tract profile', 'Census ACS')
    share = c['dual_earner_share']
    pts = mx if share >= 0.65 else 4 if share >= 0.5 else 2
    inc = f'; median household income ${c["median_hh_income"]:,}' if c.get('median_hh_income') else ''
    return Signal('dual_income_area', 'busy dual-income household', pts, mx,
                  f'{share:.0%} of two-parent families in this tract have both parents working{inc}', f'Census ACS 2023 tract {c["tract_geoid"]}')
