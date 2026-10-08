"""Pipeline entrypoint: python -m doorscore.run [--territory path] [--force]

Stages are idempotent and cached, so re-running is cheap and safe.
"""
import argparse, json, time
from .config import TERRITORY, OUT
from .territory import load_polygon
from .harvest.parcels import fetch_parcels
from .normalize import build_door, door_dict
from .score import score_doors
from .costs import summary as cost_summary

def coverage_report(parcels, doors):
    n = len(doors) or 1
    def pct(k): return round(100 * sum(1 for d in doors if d.get(k) is not None) / n, 1)
    return {
        'parcels_in_polygon': len(parcels),
        'single_family_homes': len(doors),
        'pct_with_address': round(100 * sum(1 for d in doors if d['address'] and d['address'][0].isdigit()) / n, 1),
        'pct_with_deed_date': pct('deed_date'),
        'pct_with_year_built': pct('year_built'),
        'pct_with_assessed_value': pct('net_value'),
        'pct_owner_occupancy_resolved': pct('owner_occupied'),
        'pct_building_desc_parsed': pct('stories'),
        'absentee_owners': sum(1 for d in doors if d['owner_occupied'] is False),
        'new_movers_36mo': sum(1 for d in doors if (d['months_since_deed'] or 999) <= 36 and d['arms_length_sale']),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--territory', default=str(TERRITORY))
    ap.add_argument('--force', action='store_true', help='ignore caches')
    ap.add_argument('--vision', action='store_true', help='fetch Street View imagery and run the vision model')
    ap.add_argument('--vision-model', default=None, help='override vision model id')
    ap.add_argument('--limit', type=int, default=None, help='only run imagery/vision for the first N doors (by harvest order)')
    args = ap.parse_args()
    t0 = time.time()
    poly = load_polygon(args.territory)
    parcels = fetch_parcels(poly, force=args.force)
    print(f'[harvest] {len(parcels)} parcels intersect territory ({time.time()-t0:.1f}s)')
    doors = [door_dict(d) for d in (build_door(f) for f in parcels) if d]
    # keep only parcels whose representative point is inside (edge parcels merely touching are excluded)
    from shapely.geometry import Point
    doors = [d for d in doors if poly.contains(Point(d['lng'], d['lat']))]
    print(f'[normalize] {len(doors)} single-family doors')
    from .harvest.census import enrich as census_enrich
    doors = census_enrich(doors)
    if args.vision:
        from .vision.stage import run_vision
        from .vision.detect import DEFAULT_MODEL
        doors = run_vision(doors, model=args.vision_model or DEFAULT_MODEL, limit=args.limit)
    scored = score_doors(doors)
    report = coverage_report(parcels, scored)
    report['doors_with_imagery'] = sum(1 for d in scored if d.get('vision'))
    report['doors_with_usable_imagery'] = sum(1 for d in scored if (d.get('vision') or {}).get('signals', {}).get('image_usable'))
    report['cost'] = cost_summary()
    (OUT / 'doors.json').write_text(json.dumps(scored, indent=1))
    geo = {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [d['lng'], d['lat']]},
         'properties': {k: v for k, v in d.items() if k not in ('lat', 'lng')}} for d in scored]}
    (OUT / 'doors.geojson').write_text(json.dumps(geo))
    (OUT / 'run_report.json').write_text(json.dumps(report, indent=1))
    print('[report]', json.dumps(report, indent=1))
    print(f'[done] wrote {OUT}/doors.json, doors.geojson, run_report.json in {time.time()-t0:.1f}s')

if __name__ == '__main__':
    main()
