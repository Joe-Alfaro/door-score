"""Street View imagery per door, with a free metadata pre-check and disk caching.

Metadata requests are free and tell us whether a panorama exists and when it was shot,
so we only pay for images that will actually be analyzable.
"""
import json
import requests
from ..config import CACHE, GOOGLE_MAPS_API_KEY
from ..costs import record, STREETVIEW_IMAGE_USD

META_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata'
IMG_URL = 'https://maps.googleapis.com/maps/api/streetview'
IMG_DIR = CACHE / 'streetview'
META_DIR = CACHE / 'streetview_meta'
IMG_DIR.mkdir(exist_ok=True); META_DIR.mkdir(exist_ok=True)
SIZE = '640x640'
# Lot centroids on big parcels can sit >60 m from the road; widen the search in steps.
RADII_M = (60, 120, 200)
APPROX_M = 90   # camera farther than this from the parcel point is flagged 'approximate'

def _key():
    if not GOOGLE_MAPS_API_KEY:
        raise RuntimeError('GOOGLE_MAPS_API_KEY not set')
    return GOOGLE_MAPS_API_KEY

def _haversine_m(lat1, lng1, lat2, lng2):
    from math import radians, sin, cos, asin, sqrt
    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 6371000 * 2 * asin(sqrt(a))

def pano_metadata(door: dict) -> dict:
    """Nearest outdoor panorama to the parcel, widening the radius as needed. Cached; free."""
    p = META_DIR / f'{door["door_id"]}.json'
    if p.exists():
        return json.loads(p.read_text())
    meta = {'status': 'ZERO_RESULTS'}
    for radius in RADII_M:
        r = requests.get(META_URL, params={'location': f'{door["lat"]},{door["lng"]}', 'radius': radius,
                                           'source': 'outdoor', 'key': _key()}, timeout=30)
        r.raise_for_status()
        meta = r.json()
        if meta.get('status') == 'OK':
            meta['radius_used'] = radius
            meta['distance_m'] = round(_haversine_m(door['lat'], door['lng'], meta['location']['lat'], meta['location']['lng']))
            break
    p.write_text(json.dumps(meta))
    return meta

def fetch_image(door: dict) -> dict | None:
    """Download one 640x640 Street View image aimed at the parcel. Returns {path, date, pano_id} or None."""
    meta = pano_metadata(door)
    if meta.get('status') != 'OK':
        return None
    path = IMG_DIR / f'{door["door_id"]}.jpg'
    info = {'path': str(path), 'date': meta.get('date'), 'pano_id': meta.get('pano_id'),
            'pano_lat': meta['location']['lat'], 'pano_lng': meta['location']['lng'],
            'distance_m': meta.get('distance_m'), 'approximate': (meta.get('distance_m') or 0) > APPROX_M}
    if path.exists():
        return info
    # Use the resolved pano and let the API compute the heading toward the parcel point.
    r = requests.get(IMG_URL, params={'pano': meta['pano_id'], 'location': f'{door["lat"]},{door["lng"]}',
                                      'size': SIZE, 'fov': 80, 'pitch': 5, 'return_error_code': 'true',
                                      'key': _key()}, timeout=60)
    if r.status_code != 200 or not r.headers.get('content-type', '').startswith('image'):
        return None
    path.write_bytes(r.content)
    record('streetview_image', STREETVIEW_IMAGE_USD, door['door_id'], pano_date=meta.get('date'))
    return info

def harvest(doors: list[dict], limit: int | None = None) -> dict[str, dict]:
    out = {}
    for d in doors[:limit] if limit else doors:
        try:
            info = fetch_image(d)
        except requests.RequestException as e:
            info = None
            print(f'[streetview] {d["address"]}: {e}')
        if info:
            out[d['door_id']] = info
    return out
