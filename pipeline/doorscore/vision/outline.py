"""Draw the parcel boundary onto an overhead tile before the model sees it.

Without it the model cannot tell which lot a pool or a solar array belongs to; a human labeler
asked for the same overlay. Outlined tiles live in data/cache/satellite_outlined/ (gitignored:
derived from Google imagery) and are regenerated on demand from the parcel polygons.
"""
import json, math
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw
from ..config import CACHE

TILE, ZOOM = 640, 20
OUT_DIR = CACHE / 'satellite_outlined'; OUT_DIR.mkdir(exist_ok=True)

def _px(lat, lng):
    n = 256 * 2 ** ZOOM
    return (lng + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n

@lru_cache(maxsize=1)
def _parcels() -> dict:
    out = {}
    for pf in CACHE.glob('parcels_*.geojson'):
        for f in json.loads(pf.read_text())['features']:
            pin = f['properties'].get('PAMS_PIN')
            if pin and pin not in out and f.get('geometry'):
                g = f['geometry']
                out[pin] = g['coordinates'] if g['type'] == 'Polygon' else [r for poly in g['coordinates'] for r in poly]
    return out

def outlined_tile(tile_path: str, door: dict) -> str:
    """Return the path of a copy of the tile with the door's parcel outlined; the original if no polygon."""
    rings = _parcels().get(door['door_id'])
    if not rings:
        return tile_path
    out = OUT_DIR / f'{door["door_id"]}.png'
    if out.exists():
        return str(out)
    cx, cy = _px(door['lat'], door['lng'])
    im = Image.open(tile_path).convert('RGB'); d = ImageDraw.Draw(im)
    for ring in rings:
        pts = [(_px(lat, lng)[0] - cx + TILE / 2, _px(lat, lng)[1] - cy + TILE / 2) for lng, lat in ring]
        d.polygon(pts, outline=(255, 230, 0), width=4)
    d.ellipse([TILE / 2 - 4, TILE / 2 - 4, TILE / 2 + 4, TILE / 2 + 4], fill=(255, 230, 0))
    im.save(out)
    return str(out)
