"""Pipeline entrypoint: python -m doorscore.run --territory path/to/area.geojson [--force]

There is no default area: pass the polygon to score (the web map's "Draw an area" does this via
POST /api/territory), or place one at data/territory.geojson (gitignored).

Stages are idempotent and cached, so re-running is cheap and safe.
"""
import argparse, json, time
from pathlib import Path
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

def entity_resolution_report(parcels, doors):
    """How messy the source addresses were and how well the normalizer and the block/lot join resolved them."""
    from collections import Counter
    from .normalize import normalize_address
    raw_suffixes = Counter((f['properties'].get('PROP_LOC') or '').split()[-1] for f in parcels if f['properties'].get('PROP_LOC'))
    canon_suffixes = Counter(normalize_address(f['properties'].get('PROP_LOC')).split()[-1] for f in parcels if f['properties'].get('PROP_LOC'))
    return {
        'raw_street_suffix_spellings': len(raw_suffixes),
        'canonical_street_suffixes': len(canon_suffixes),
        'addresses_normalized_with_house_number': sum(1 for d in doors if d['address'][:1].isdigit()),
        'owner_mailing_resolved': {'owner_occupied': sum(1 for d in doors if d['owner_occupied'] is True),
                                   'absentee': sum(1 for d in doors if d['owner_occupied'] is False),
                                   'unknown': sum(1 for d in doors if d['owner_occupied'] is None)},
        'permit_block_lot_join_rate': round(sum(1 for d in doors if (d.get('permits') or {}).get('permits_10yr')) / max(len(doors), 1), 3),
        'census_tract_join_rate': round(sum(1 for d in doors if d.get('census')) / max(len(doors), 1), 3),
        'street_view_pano_resolved': round(sum(1 for d in doors if d.get('vision')) / max(len(doors), 1), 3),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--territory', default=None, help='GeoJSON polygon to score (default: data/territory.geojson if present)')
    ap.add_argument('--force', action='store_true', help='ignore caches')
    ap.add_argument('--vision', action='store_true', help='fetch Street View imagery and run the vision model')
    ap.add_argument('--vision-model', default=None, help='override vision model id')
    ap.add_argument('--no-satellite', action='store_true', help='skip the overhead imagery stage (runs with --vision by default)')
    ap.add_argument('--limit', type=int, default=None, help='only run imagery/vision for the first N doors (by harvest order)')
    ap.add_argument('--vision-cache-only', action='store_true', help='use cached vision results only; never fetch imagery or call a model (free)')
    ap.add_argument('--out', default=None, help='output directory (default data/out)')
    args = ap.parse_args()
    out_dir = Path(args.out) if args.out else OUT
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    territory = Path(args.territory) if args.territory else TERRITORY
    if not territory.exists():
        raise SystemExit(f'no area to score: {territory} not found. Draw an area in the map or pass --territory path/to/area.geojson')
    poly = load_polygon(territory)
    parcels = fetch_parcels(poly, force=args.force)
    print(f'[harvest] {len(parcels)} parcels intersect territory ({time.time()-t0:.1f}s)')
    doors = [door_dict(d) for d in (build_door(f) for f in parcels) if d]
    # keep only parcels whose representative point is inside (edge parcels merely touching are excluded)
    from shapely.geometry import Point
    doors = [d for d in doors if poly.contains(Point(d['lng'], d['lat']))]
    print(f'[normalize] {len(doors)} single-family doors')
    from .harvest.census import enrich as census_enrich
    from .harvest.permits import enrich as permits_enrich
    doors = census_enrich(doors)
    try:
        doors = permits_enrich(doors)
    except Exception as e:
        print(f'[permits] skipped: {e}')
    if args.vision:
        from .vision.stage import run_vision
        from .vision.detect import DEFAULT_MODEL
        doors = run_vision(doors, model=args.vision_model or DEFAULT_MODEL, limit=args.limit, cache_only=args.vision_cache_only)
        if not args.no_satellite:
            from .vision.satellite_stage import run_satellite
            doors = run_satellite(doors, model=args.vision_model or DEFAULT_MODEL, limit=args.limit, cache_only=args.vision_cache_only)
    scored = score_doors(doors)
    for d in scored:
        # Published output carries no local filesystem paths and no tax-exemption category.
        for key in ('vision', 'satellite'):
            img = (d.get(key) or {}).get('image')
            if img and 'path' in img:
                img.pop('path', None)
        d.pop('tax_exempt_residence', None)
    report = coverage_report(parcels, scored)
    report['entity_resolution'] = entity_resolution_report(parcels, scored)
    report['doors_with_permit_history'] = sum(1 for d in scored if (d.get('permits') or {}).get('permits_10yr'))
    report['doors_with_imagery'] = sum(1 for d in scored if d.get('vision'))
    report['doors_with_usable_imagery'] = sum(1 for d in scored if (d.get('vision') or {}).get('signals', {}).get('image_usable'))
    report['doors_with_usable_satellite'] = sum(1 for d in scored if (d.get('satellite') or {}).get('signals', {}).get('image_usable'))
    report['cost'] = cost_summary()
    (out_dir / 'doors.json').write_text(json.dumps(scored, indent=1))
    geo = {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [d['lng'], d['lat']]},
         'properties': {k: v for k, v in d.items() if k not in ('lat', 'lng')}} for d in scored]}
    (out_dir / 'doors.geojson').write_text(json.dumps(geo))
    (out_dir / 'run_report.json').write_text(json.dumps(report, indent=1))
    print('[report]', json.dumps(report, indent=1))
    print(f'[done] wrote {out_dir}/doors.json, doors.geojson, run_report.json in {time.time()-t0:.1f}s')

if __name__ == '__main__':
    main()
