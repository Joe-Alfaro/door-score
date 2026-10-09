"""Overhead satellite imagery per door from the Google Maps Static API, with disk caching.

One fixed-zoom tile centered on the parcel point. Unlike Street View there is no free
metadata pre-check, so every uncached fetch is a paid call and is written to the ledger.
"""
import requests
from ..config import CACHE, GOOGLE_MAPS_API_KEY
from ..costs import record, STATIC_MAP_IMAGE_USD

URL = 'https://maps.googleapis.com/maps/api/staticmap'
IMG_DIR = CACHE / 'satellite'
IMG_DIR.mkdir(exist_ok=True)
ZOOM = 20          # ~0.15 m/px at this latitude: one lot plus a sliver of neighbors
SIZE = '640x640'
_EXT_FOR = {'image/png': 'png', 'image/jpeg': 'jpg'}


class SatelliteAccessError(RuntimeError):
    """The key cannot use the Maps Static API (403 / REQUEST_DENIED). Not a per-door failure."""


def _key():
    if not GOOGLE_MAPS_API_KEY:
        raise RuntimeError('GOOGLE_MAPS_API_KEY not set')
    return GOOGLE_MAPS_API_KEY

def _redact(text: str) -> str:
    return text.replace(_key(), '<KEY>')

def _cached(door_id: str):
    for ext in ('png', 'jpg'):
        p = IMG_DIR / f'{door_id}.{ext}'
        if p.exists():
            return p
    return None

def image_info(door: dict) -> dict:
    """Expected tile location and zoom without downloading (path may not exist yet)."""
    cached = _cached(door['door_id'])
    return {'path': str(cached or IMG_DIR / f'{door["door_id"]}.png'), 'zoom': ZOOM}

def fetch_image(door: dict) -> dict | None:
    """Download one 640x640 satellite tile centered on the parcel. Returns {path, zoom} or None."""
    cached = _cached(door['door_id'])
    if cached:
        return {'path': str(cached), 'zoom': ZOOM}
    r = requests.get(URL, params={'center': f'{door["lat"]},{door["lng"]}', 'zoom': ZOOM, 'size': SIZE,
                                  'maptype': 'satellite', 'key': _key()}, timeout=60)
    body = _redact(r.text) if not r.headers.get('content-type', '').startswith('image') else ''
    if r.status_code == 403 or 'REQUEST_DENIED' in body:
        raise SatelliteAccessError(f'Maps Static API denied (HTTP {r.status_code}); it is probably not enabled '
                                   f'for this key. Response: {body[:500]}')
    if r.status_code != 200 or body:
        print(f'[satellite] {door["address"]}: HTTP {r.status_code} {body[:200]}')
        return None
    ext = _EXT_FOR.get(r.headers['content-type'].split(';')[0].strip(), 'jpg')
    path = IMG_DIR / f'{door["door_id"]}.{ext}'
    path.write_bytes(r.content)
    record('satellite_image', STATIC_MAP_IMAGE_USD, door['door_id'], zoom=ZOOM)
    return {'path': str(path), 'zoom': ZOOM}

def harvest(doors: list[dict], limit: int | None = None) -> dict[str, dict]:
    """Per-door network errors are logged and skipped; an access denial propagates so the
    caller can stop and report it rather than paying for 500 identical failures."""
    out = {}
    for d in doors[:limit] if limit else doors:
        try:
            info = fetch_image(d)
        except requests.RequestException as e:
            info = None
            print(f'[satellite] {d["address"]}: {e}')
        if info:
            out[d['door_id']] = info
    return out
