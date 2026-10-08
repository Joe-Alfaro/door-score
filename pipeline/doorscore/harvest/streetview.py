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
RADIUS_M = 60

def _key():
    if not GOOGLE_MAPS_API_KEY:
        raise RuntimeError('GOOGLE_MAPS_API_KEY not set')
    return GOOGLE_MAPS_API_KEY

def pano_metadata(door: dict) -> dict:
    """Nearest outdoor panorama to the parcel. Cached; free."""
    p = META_DIR / f'{door["door_id"]}.json'
    if p.exists():
        return json.loads(p.read_text())
    r = requests.get(META_URL, params={'location': f'{door["lat"]},{door["lng"]}', 'radius': RADIUS_M,
                                       'source': 'outdoor', 'key': _key()}, timeout=30)
    r.raise_for_status()
    meta = r.json()
    p.write_text(json.dumps(meta))
    return meta

def fetch_image(door: dict) -> dict | None:
    """Download one 640x640 Street View image aimed at the parcel. Returns {path, date, pano_id} or None."""
    meta = pano_metadata(door)
    if meta.get('status') != 'OK':
        return None
    path = IMG_DIR / f'{door["door_id"]}.jpg'
    info = {'path': str(path), 'date': meta.get('date'), 'pano_id': meta.get('pano_id'),
            'pano_lat': meta['location']['lat'], 'pano_lng': meta['location']['lng']}
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
