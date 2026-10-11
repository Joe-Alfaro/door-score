"""Census ACS 5-year tract profile for each door — aggregate household inference, no PII.

Two free endpoints: the Census Geocoder (lat/lng -> tract GEOID, no key) and the ACS data API
(free key from https://api.census.gov/data/key_signup.html, env CENSUS_API_KEY).
Gives the 'dual-income, hires-out' prior that parcel data alone cannot: share of families with
children where both parents work, median household income, owner-occupancy, recent movers.
"""
import json
import requests
from ..config import CACHE, CENSUS_API_KEY

GEO_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'
ACS_URL = 'https://api.census.gov/data/2023/acs/acs5'
VARS = {
    'B19013_001E': 'median_hh_income',
    'B23008_001E': 'kids_total', 'B23008_003E': 'kids_two_parents_u6', 'B23008_004E': 'kids_both_parents_work_u6',
    'B23008_010E': 'kids_two_parents_6_17', 'B23008_011E': 'kids_both_parents_work_6_17',
    'B25003_001E': 'occupied_units', 'B25003_002E': 'owner_occupied_units',
    'B07003_001E': 'pop_1plus', 'B07003_004E': 'same_house_1yr',
    'B25077_001E': 'median_home_value',
}
TRACT_DIR = CACHE / 'census_tract'; TRACT_DIR.mkdir(exist_ok=True)
ACS_CACHE = CACHE / 'acs_tracts.json'

def tract_for(door: dict) -> str | None:
    p = TRACT_DIR / f'{door["door_id"]}.json'
    if p.exists():
        return json.loads(p.read_text()).get('geoid')
    try:
        r = requests.get(GEO_URL, params={'x': door['lng'], 'y': door['lat'], 'benchmark': 'Public_AR_Current',
                                          'vintage': 'Current_Current', 'format': 'json'}, timeout=30)
        tr = r.json()['result']['geographies']['Census Tracts'][0]
        geoid = tr['GEOID']
    except Exception:
        geoid = None
    p.write_text(json.dumps({'geoid': geoid}))
    return geoid

def acs_profile(geoid: str) -> dict:
    cache = json.loads(ACS_CACHE.read_text()) if ACS_CACHE.exists() else {}
    if geoid in cache:
        return cache[geoid]
    state, county, tract = geoid[:2], geoid[2:5], geoid[5:]
    if not CENSUS_API_KEY:
        raise RuntimeError('CENSUS_API_KEY not set')
    r = requests.get(ACS_URL, params={'get': ','.join(VARS), 'for': f'tract:{tract}', 'in': f'state:{state} county:{county}',
                                      'key': CENSUS_API_KEY}, timeout=30, allow_redirects=False)
    if r.status_code != 200:
        raise RuntimeError(f'ACS query failed: HTTP {r.status_code} {r.text[:120]}')
    hdr, row = r.json()
    raw = {VARS[h]: (int(v) if v not in (None, '') and int(v) >= 0 else None) for h, v in zip(hdr, row) if h in VARS}
    def ratio(a, b): return round(a / b, 3) if a is not None and b else None
    prof = {
        'tract_geoid': geoid,
        'median_hh_income': raw['median_hh_income'],
        'median_home_value': raw['median_home_value'],
        'dual_earner_share': ratio((raw['kids_both_parents_work_u6'] or 0) + (raw['kids_both_parents_work_6_17'] or 0),
                                   (raw['kids_two_parents_u6'] or 0) + (raw['kids_two_parents_6_17'] or 0)),
        'owner_occupied_share': ratio(raw['owner_occupied_units'], raw['occupied_units']),
        'moved_last_year_share': ratio((raw['pop_1plus'] or 0) - (raw['same_house_1yr'] or 0), raw['pop_1plus']),
    }
    cache[geoid] = prof
    ACS_CACHE.write_text(json.dumps(cache, indent=1))
    return prof

def enrich(doors: list[dict]) -> list[dict]:
    if not CENSUS_API_KEY:
        print('[census] CENSUS_API_KEY not set; skipping tract enrichment')
        for d in doors: d['census'] = None
        return doors
    failed = set()
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(8) as ex:   # geocoder calls are independent; 569 doors take ~30 s instead of ~4 min
        geoids = list(ex.map(tract_for, doors))
    for d, g in zip(doors, geoids):
        if not g or g in failed:
            d['census'] = None; continue
        try:
            d['census'] = acs_profile(g)
        except Exception as e:
            print(f'[census] {g}: {e}'); failed.add(g); d['census'] = None
    tracts = {d['census']['tract_geoid'] for d in doors if d.get('census')}
    n_ok = sum(1 for d in doors if d.get('census'))
    print(f'[census] {n_ok} doors enriched across {len(tracts)} tracts' if n_ok else '[census] no tract profiles (check CENSUS_API_KEY activation)')
    return doors
