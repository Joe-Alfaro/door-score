"""Pick a territory polygon containing ~N single-family homes around a seed point.

Used only because no polygon was provided. The rest of the pipeline treats the
output polygon as an opaque input, so a supplied polygon can replace it.
"""
import json, sys
from shapely.geometry import shape, mapping, MultiPoint
from shapely.ops import unary_union

RAW = 'data/raw/ramsey_parcels_all.geojson'
OUT = 'data/territory.geojson'
PREVIEW = 'data/territory_preview.html'
SEED_LAT, SEED_LNG = 41.04396, -74.14853
TARGET = 540

def is_sfh(a):
    """Single-family: residential (class 2) or exempt residential (15F), not a condo unit, one dwelling, real lot."""
    if a['PROP_CLASS'] not in ('2', '15F'): return False
    if (a['PCLQCODE'] or '').startswith('C'): return False
    if (a['DWELL'] or 1) != 1: return False
    if (a['CALC_ACRE'] or 0) < 0.05: return False
    return True

feats = json.load(open(RAW))['features']
for f in feats:
    f['_g'] = shape(f['geometry']); f['_c'] = f['_g'].representative_point()
sfh = [f for f in feats if is_sfh(f['properties'])]
sfh.sort(key=lambda f: (f['_c'].x - SEED_LNG) ** 2 + (f['_c'].y - SEED_LAT) ** 2)

def build(k):
    hull = unary_union([f['_g'] for f in sfh[:k]]).convex_hull.buffer(0.00005)
    inside = [f for f in feats if hull.contains(f['_c'])]
    return hull, inside

k = TARGET
for _ in range(20):
    hull, inside = build(k)
    n = sum(is_sfh(f['properties']) for f in inside)
    if abs(n - TARGET) <= 3: break
    k -= (n - TARGET) // 2 or (1 if n > TARGET else -1)

n_sfh = sum(is_sfh(f['properties']) for f in inside)
print(f'k={k} parcels_inside={len(inside)} sfh_inside={n_sfh} area_km2={hull.area*111.32*0.7545*110.57:.2f}')
json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature',
    'properties': {'name': 'Ramsey NJ territory', 'target_homes': TARGET, 'sfh_count': n_sfh},
    'geometry': mapping(hull)}]}, open(OUT, 'w'))

def feat(f, kind):
    a = f['properties']
    return {'type': 'Feature', 'geometry': mapping(f['_g']), 'properties': {
        'kind': kind, 'loc': a['PROP_LOC'], 'cls': a['PROP_CLASS'], 'yr': a['YR_CONSTR'], 'acre': a['CALC_ACRE']}}
layers = {'territory': mapping(hull),
          'sfh': [feat(f, 'sfh') for f in inside if is_sfh(f['properties'])],
          'other': [feat(f, 'other') for f in inside if not is_sfh(f['properties'])]}
html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Territory check</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{{height:100%;margin:0}} .lg{{position:absolute;top:10px;right:10px;z-index:1000;background:#fff;padding:8px 12px;font:13px system-ui;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.3)}}</style>
</head><body><div id="map"></div>
<div class="lg"><b>Ramsey territory</b><br>Single-family inside: {n_sfh}<br>Other parcels inside: {len(layers['other'])}<br>
<span style="color:#2a9d8f">■</span> single-family &nbsp; <span style="color:#e76f51">■</span> other</div>
<script>
const D={json.dumps(layers)};
const map=L.map('map');
L.tileLayer('https://tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png',{{maxZoom:19,attribution:'© OpenStreetMap'}}).addTo(map);
const pop=f=>`${{f.properties.loc}}<br>class ${{f.properties.cls}} · built ${{f.properties.yr}} · ${{f.properties.acre}} ac`;
L.geoJSON({{type:'FeatureCollection',features:D.sfh}},{{style:{{color:'#2a9d8f',weight:1,fillOpacity:.35}},onEachFeature:(f,l)=>l.bindPopup(pop(f))}}).addTo(map);
L.geoJSON({{type:'FeatureCollection',features:D.other}},{{style:{{color:'#e76f51',weight:1,fillOpacity:.45}},onEachFeature:(f,l)=>l.bindPopup(pop(f))}}).addTo(map);
const t=L.geoJSON(D.territory,{{style:{{color:'#264653',weight:3,fill:false,dashArray:'6 4'}}}}).addTo(map);
const fit=()=>{map.invalidateSize();map.fitBounds(t.getBounds().pad(0.1));};fit();window.addEventListener("resize",fit);setTimeout(fit,800);
</script></body></html>"""
open(PREVIEW, 'w').write(html)
print('wrote', OUT, PREVIEW)
