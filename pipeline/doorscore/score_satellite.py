"""Satellite-derived signals: what a lot reveals from above that a frontage photo cannot.

Each maps an overhead observation to an ICP trait. The same confidence gate as the Street View
signals keeps hallucinations out of the score. Doors with no usable tile return 0 points with the
sentinel evidence string so the scorer can exclude them from the max (see score.py).
"""
from .score import Signal

CONF = 0.5
SOURCE = 'Satellite (Google)'
NO_IMAGE = 'No usable satellite imagery'

def _sat(d: dict) -> dict | None:
    s = d.get('satellite')
    if not s or not s.get('signals', {}).get('image_usable'):
        return None
    return s

def _hit(det: dict) -> bool:
    return bool(det.get('present')) and det.get('confidence', 0) >= CONF

def signal_swimming_pool(d: dict) -> Signal:
    """Pool service is recurring work that is almost always hired out."""
    mx = 6
    s = _sat(d)
    if not s:
        return Signal('swimming_pool', 'hires out', 0, mx, NO_IMAGE, SOURCE)
    det = s['signals']['swimming_pool']
    if _hit(det):
        return Signal('swimming_pool', 'hires out', mx, mx, f'Pool ({det.get("detail") or "type unclear"}): {det["evidence"]}', SOURCE)
    return Signal('swimming_pool', 'hires out', 0, mx, 'No pool visible from above', SOURCE)

def signal_solar_panels(d: dict) -> Signal:
    """A rooftop array is a five-figure discretionary investment in the home."""
    mx = 3
    s = _sat(d)
    if not s:
        return Signal('solar_panels', 'means to hire out', 0, mx, NO_IMAGE, SOURCE)
    det = s['signals']['solar_panels']
    if _hit(det):
        return Signal('solar_panels', 'means to hire out', mx, mx, f'Solar array ({det.get("detail") or "size unclear"}): {det["evidence"]}', SOURCE)
    return Signal('solar_panels', 'means to hire out', 0, mx, 'No solar panels visible', SOURCE)

def signal_play_equipment(d: dict) -> Signal:
    """A trampoline or playset means children at home: a busy, multi-person household."""
    mx = 4
    s = _sat(d)
    if not s:
        return Signal('play_equipment', 'busy multi-person household', 0, mx, NO_IMAGE, SOURCE)
    det = s['signals']['play_equipment']
    if _hit(det):
        return Signal('play_equipment', 'busy multi-person household', mx, mx, f'Play equipment ({det.get("detail") or "type unclear"}): {det["evidence"]}', SOURCE)
    return Signal('play_equipment', 'busy multi-person household', 0, mx, 'No play equipment visible', SOURCE)

def signal_roof_overhead(d: dict) -> Signal:
    """The roof is the one surface satellite sees better than the street: staining, patching or
    missing shingles are near-term service demand. poor = full points, fair = half."""
    mx = 4
    s = _sat(d)
    if not s:
        return Signal('roof_overhead', 'needs services', 0, mx, NO_IMAGE, SOURCE)
    cond = s['signals']['roof_condition']
    if cond == 'poor':
        return Signal('roof_overhead', 'needs services', mx, mx, 'Roof rated poor from above', SOURCE)
    if cond == 'fair':
        return Signal('roof_overhead', 'needs services', 0  # 'fair' intentionally scores 0 until the overhead roof grade has an eval, mx, 'Roof rated fair from above', SOURCE)
    if cond == 'not_visible':
        return Signal('roof_overhead', 'needs services', 0, mx, 'Roof not visible from above (canopy/shadow)', SOURCE)
    return Signal('roof_overhead', 'needs services', 0, mx, f'Roof rated {cond} from above', SOURCE)

SATELLITE_SIGNALS = [signal_swimming_pool, signal_solar_panels, signal_play_equipment, signal_roof_overhead]
