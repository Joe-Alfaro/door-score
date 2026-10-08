"""Harvest NJ statewide parcel + MOD-IV tax records intersecting a polygon.

Source: NJ Office of GIS 'Parcels Composite of NJ' ArcGIS feature service (public, no key).
Owner names are already redacted server-side under Daniel's Law; we never request or store them.
"""
import hashlib, json, time
import requests
from shapely.geometry.base import BaseGeometry
from ..config import CACHE
from ..territory import to_esri_rings

SERVICE = ('https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/'
           'Parcels_Composite_NJ_WM/FeatureServer/0/query')
PAGE = 2000
# Explicit field list: excludes OWNER_NAME on purpose. Mailing address fields are
# fetched only to derive an owner-occupied flag and are dropped during normalization.
FIELDS = ['PAMS_PIN', 'PCL_MUN', 'PCLBLOCK', 'PCLLOT', 'PCLQCODE', 'PROP_CLASS', 'COUNTY', 'MUN_NAME',
          'PROP_LOC', 'ST_ADDRESS', 'CITY_STATE', 'ZIP5', 'LAND_VAL', 'IMPRVT_VAL', 'NET_VALUE',
          'LAST_YR_TX', 'BLDG_DESC', 'LAND_DESC', 'CALC_ACRE', 'BLDG_CLASS', 'DEED_DATE',
          'YR_CONSTR', 'SALES_CODE', 'SALE_PRICE', 'DWELL', 'PCLLASTUPD']

def _cache_key(poly: BaseGeometry) -> str:
    return hashlib.sha1(poly.wkb).hexdigest()[:12]

def fetch_parcels(poly: BaseGeometry, force: bool = False) -> list[dict]:
    """Return GeoJSON features for every parcel intersecting the polygon. Cached by polygon hash."""
    cache = CACHE / f'parcels_{_cache_key(poly)}.geojson'
    if cache.exists() and not force:
        return json.loads(cache.read_text())['features']
    feats, offset = [], 0
    while True:
        params = {
            'where': '1=1', 'geometry': json.dumps(to_esri_rings(poly)), 'geometryType': 'esriGeometryPolygon',
            'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': ','.join(FIELDS),
            'outSR': 4326, 'resultOffset': offset, 'resultRecordCount': PAGE, 'orderByFields': 'OBJECTID',
            'f': 'geojson'}
        for attempt in range(4):
            r = requests.post(SERVICE, data=params, timeout=120)
            if r.ok and 'features' in r.json():
                break
            time.sleep(2 ** attempt)
        else:
            raise RuntimeError(f'parcel query failed at offset {offset}: {r.text[:200]}')
        page = r.json()['features']
        feats += page
        if len(page) < PAGE:
            break
        offset += PAGE
    cache.write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}))
    return feats
