import json
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.geometry.base import BaseGeometry

def load_polygon(path: Path) -> BaseGeometry:
    """Accept a GeoJSON Feature, FeatureCollection, or bare geometry. Union everything into one shape."""
    doc = json.loads(Path(path).read_text())
    if doc.get('type') == 'FeatureCollection':
        geoms = [shape(f['geometry']) for f in doc['features']]
    elif doc.get('type') == 'Feature':
        geoms = [shape(doc['geometry'])]
    else:
        geoms = [shape(doc)]
    from shapely.ops import unary_union
    return unary_union(geoms)

def to_esri_rings(poly: BaseGeometry) -> dict:
    g = mapping(poly)
    rings = g['coordinates'] if g['type'] == 'Polygon' else [r for p in g['coordinates'] for r in p]
    return {'rings': [[list(c) for c in ring] for ring in rings], 'spatialReference': {'wkid': 4326}}
