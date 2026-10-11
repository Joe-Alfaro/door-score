"""Console API: inspect pipeline state and run stages with live logs.

    uvicorn doorscore.api:app --port 8000   (or: make api)

Stages run as subprocesses of the same package so the console exercises exactly the code a
reviewer would run from the shell. Every stage reports its cache state and an estimated cost
before it runs; paid stages refuse to start without the keys they need, without an explicit
confirmation, or when the estimate would push the ledger past MAX_SPEND_USD.

Mutations (POST /api/run/*, POST /api/runs/*/cancel) require `X-Console-Token: $CONSOLE_TOKEN`.
With CONSOLE_TOKEN unset they are only accepted from the loopback interface, so a local demo needs
no configuration while a public deployment without a token is read-only.
"""
import asyncio, hashlib, hmac, json, os, subprocess, sys, time, uuid
from pathlib import Path
import requests
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from .config import DATA, CACHE, OUT, TERRITORY, ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, CENSUS_API_KEY
from .costs import summary as cost_summary, STREETVIEW_IMAGE_USD, STATIC_MAP_IMAGE_USD, LEDGER

app = FastAPI(title='Door Score console API')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

WEB_URL = os.getenv('WEB_URL', 'https://web-production-39b2a.up.railway.app')
MCP_URL = os.getenv('MCP_URL', 'https://mcp-production-1645.up.railway.app')
CONSOLE_TOKEN = os.getenv('CONSOLE_TOKEN') or None
MAX_SPEND_USD = float(os.getenv('MAX_SPEND_USD', '45'))
PY = sys.executable
PIPELINE_DIR = Path(__file__).resolve().parents[1]
RUNS_DIR = CACHE / 'runs'; RUNS_DIR.mkdir(parents=True, exist_ok=True)
RUNS_FILE = RUNS_DIR / 'runs.json'
RUNS: dict[str, dict] = {}
PROCS: dict[str, subprocess.Popen] = {}   # live subprocess handles; never persisted
LOOPBACK = {'127.0.0.1', '::1', 'localhost', 'testclient'}

# Per-door production estimates (measured): Street View image + Sonnet call, satellite tile + Sonnet call.
EST_STREET = STREETVIEW_IMAGE_USD + 0.0085
EST_SAT = STATIC_MAP_IMAGE_USD + 0.0076

# ---------------------------------------------------------------- auth

def require_token(request: Request) -> None:
    """Mutations need the console token; with no token configured, only loopback clients may mutate.
    The peer address comes from the TCP connection, not a forwardable header, so it cannot be spoofed."""
    if CONSOLE_TOKEN:
        sent = request.headers.get('x-console-token', '')
        if not hmac.compare_digest(sent, CONSOLE_TOKEN):
            raise HTTPException(401, 'X-Console-Token header missing or wrong')
        return
    host = request.client.host if request.client else None
    if host not in LOOPBACK:
        raise HTTPException(403, 'CONSOLE_TOKEN is not configured; mutations are only accepted from localhost')

# ---------------------------------------------------------------- run persistence

def _public(r: dict) -> dict:
    return {k: v for k, v in r.items() if k != 'proc'}

def _save_runs() -> None:
    tmp = RUNS_FILE.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(sorted(RUNS.values(), key=lambda r: r['started']), indent=1))
    tmp.replace(RUNS_FILE)

def _load_runs() -> None:
    if not RUNS_FILE.exists(): return
    try:
        rows = json.loads(RUNS_FILE.read_text())
    except json.JSONDecodeError:
        return
    for r in rows:
        if r.get('status') == 'running':   # the process died with the previous server
            r['status'] = 'interrupted'; r['ended'] = r.get('ended') or time.time()
        RUNS[r['id']] = r
    _save_runs()

_load_runs()

def _refresh(r: dict) -> None:
    p = PROCS.get(r['id'])
    if p is None or r['status'] != 'running' or p.poll() is None: return
    r['status'] = 'succeeded' if p.returncode == 0 else 'failed'; r['exit_code'] = p.returncode; r['ended'] = time.time()
    PROCS.pop(r['id'], None); _save_runs()

def _active_run() -> dict | None:
    for r in RUNS.values(): _refresh(r)
    return next((r for r in RUNS.values() if r['status'] == 'running'), None)

# ---------------------------------------------------------------- data helpers

def _out_dir(territory: str | None = None) -> Path:
    """Dataset directory: the default territory, or a custom one scored via POST /api/territory."""
    if territory:
        d = DATA / 'territories' / Path(territory).name
        if not (d / 'doors.json').exists(): raise HTTPException(404, 'unknown territory or not scored yet')
        return d
    return OUT

def _doors(territory: str | None = None) -> list[dict]:
    p = _out_dir(territory) / 'doors.json'
    return json.loads(p.read_text()) if p.exists() else []

def _labels() -> list[dict]:
    p = DATA / 'eval' / 'labels.jsonl'
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []

def _count(glob: str, sub: str) -> int:
    d = CACHE / sub
    return len(list(d.glob(glob))) if d.exists() else 0

def stages() -> list[dict]:
    n = len(_doors()) or 569
    sv_cached = _count('*.jpg', 'streetview'); sat_cached = _count('*.*', 'satellite')
    vis_cached = _count('*_v2_claude-sonnet-5-5.json', 'vision'); satvis_cached = _count('*_sat-v1_claude-sonnet-5-5.json', 'vision_satellite')
    keys = {'anthropic': bool(ANTHROPIC_API_KEY), 'google': bool(GOOGLE_MAPS_API_KEY), 'census': bool(CENSUS_API_KEY)}
    # Vision caches are keyed by free metadata (door_id + pano_id / zoom), so a door counts as cached
    # even when its image file is absent; estimate via the ledger-measured rates in costs.py.
    try:
        from .costs import estimate_vision_cost
        est_vision = float(estimate_vision_cost(_doors()))
    except Exception:
        est_vision = max(n - vis_cached, 0) * EST_STREET + max(n - satvis_cached, 0) * EST_SAT
    vision_ready = vis_cached > 0 or sv_cached > 0
    return [
        {'id': 'pipeline', 'title': 'Harvest + score', 'description': 'Parcels by polygon, permits by block/lot, Census tract profile, neighborhood effects, Door Score. Uses imagery/vision only if already cached.',
         'cmd': [PY, '-m', 'doorscore.run'] + (['--vision'] if vision_ready else []), 'paid': False, 'estimate_usd': 0.0, 'needs': ['census'] if not keys['census'] else [],
         'cache': {'parcels': _count('parcels_*.geojson', '.'), 'permits_munis': _count('*.json', 'permits'), 'census_tracts': _count('*.json', 'census_tract')},
         # The deployed image ships vision JSON but not the JPEGs it is keyed by, so a rescore there cannot reuse it.
         'warning': None if vision_ready else 'No vision caches on this disk: rescoring here runs on parcel/permit/census signals only.'},
        {'id': 'vision', 'title': 'Imagery + vision (full territory)', 'description': 'Street View + satellite tile per door, Claude vision on both, then rescore. Cached per image; only uncached doors are billed.',
         'cmd': [PY, '-m', 'doorscore.run', '--vision'], 'paid': True, 'estimate_usd': round(est_vision, 2), 'needs': [k for k, ok in (('anthropic', keys['anthropic']), ('google', keys['google'])) if not ok],
         'cache': {'street_view_images': sv_cached, 'street_vision': vis_cached, 'satellite_tiles': sat_cached, 'satellite_vision': satvis_cached}, 'accepts_limit': True},
        {'id': 'discover', 'title': 'Source discovery agent', 'description': 'Claude + web search finds public data sources for the territory and records access method, ToS and PII posture. Accumulates across runs.',
         'cmd': [PY, '-m', 'doorscore.discover'], 'paid': True, 'estimate_usd': 0.6, 'needs': [] if keys['anthropic'] else ['anthropic'], 'cache': {}},
        {'id': 'eval', 'title': 'Eval harness', 'description': 'Precision / recall / hallucination / threshold sweep for both candidate models on the human-verified sample; writes the report.',
         'cmd': [PY, '-c', 'import subprocess,sys; [subprocess.check_call([sys.executable,"-m",m]+a) for m,a in (("doorscore.eval.run_eval",[]),("doorscore.eval.run_eval",["--model","claude-haiku-4-5"]),("doorscore.eval.report",[]))]'],
         'paid': False, 'estimate_usd': 0.0, 'needs': [] if keys['anthropic'] else ['anthropic'], 'cache': {'labels': len(_labels())}},
        {'id': 'tests', 'title': 'Unit tests', 'description': 'pytest over normalization, PII handling and eval metrics.', 'cmd': [PY, '-m', 'pytest', 'tests', '-q'], 'paid': False, 'estimate_usd': 0.0, 'needs': [], 'cache': {}},
    ]

def _ping(url: str) -> dict:
    t = time.time()
    try:
        r = requests.get(url, timeout=8)
        return {'ok': r.ok, 'status': r.status_code, 'ms': round((time.time() - t) * 1000)}
    except requests.RequestException as e:
        return {'ok': False, 'status': type(e).__name__, 'ms': None}

# ---------------------------------------------------------------- read endpoints

@app.get('/api/status')
def status(territory: str | None = None):
    out = _out_dir(territory)
    rep = json.loads((out / 'run_report.json').read_text()) if (out / 'run_report.json').exists() else {}
    tfile = (out / 'territory.geojson') if territory else TERRITORY
    terr = json.loads(tfile.read_text()) if tfile.exists() else None
    tprops = dict(terr['features'][0]['properties']) if terr else None
    if tprops is not None:
        tprops['custom'] = bool(territory); tprops['territory_id'] = territory
        if territory: tprops['sfh_count'] = rep.get('single_family_homes')
    return {'report': rep, 'cost': cost_summary(), 'max_spend_usd': MAX_SPEND_USD, 'auth': 'token' if CONSOLE_TOKEN else 'localhost-only',
            'territory': tprops,
            'keys': {'anthropic': bool(ANTHROPIC_API_KEY), 'google': bool(GOOGLE_MAPS_API_KEY), 'census': bool(CENSUS_API_KEY)},
            'deployments': {'map': {'url': WEB_URL, **_ping(WEB_URL + '/')}, 'mcp': {'url': MCP_URL + '/mcp', **_ping(MCP_URL + '/health')}},
            'doors_file_mtime': (out / 'doors.json').stat().st_mtime if (out / 'doors.json').exists() else None}

SLIM = ['door_id', 'address', 'municipality', 'door_score', 'door_score_pct', 'rank', 'tags', 'year_built', 'lot_acres', 'net_value',
        'deed_date', 'months_since_deed', 'owner_occupied', 'lat', 'lng']
SORTS = {'door_score': 'desc', 'rank': 'asc', 'address': 'asc', 'net_value': 'desc', 'months_since_deed': 'asc'}

@app.get('/api/doors')
def doors(limit: int = 100, offset: int = 0, sort: str = 'rank', order: str | None = None,
          tag: str | None = None, q: str | None = None, municipality: str | None = None, territory: str | None = None):
    if sort not in SORTS: raise HTTPException(400, f'sort must be one of {", ".join(SORTS)}')
    order = order or SORTS[sort]
    if order not in ('asc', 'desc'): raise HTTPException(400, 'order must be asc or desc')
    if limit < 0 or offset < 0: raise HTTPException(400, 'limit and offset must be >= 0')
    rows = _doors(territory)
    if tag: rows = [d for d in rows if tag in d['tags']]
    if q: rows = [d for d in rows if q.upper() in d['address']]
    if municipality: rows = [d for d in rows if d['municipality'].lower() == municipality.lower()]
    # Missing values always sort last regardless of direction.
    present = [d for d in rows if d.get(sort) is not None]; missing = [d for d in rows if d.get(sort) is None]
    present.sort(key=lambda d: d[sort], reverse=order == 'desc')
    rows = present + missing
    return {'total': len(rows), 'offset': offset, 'limit': limit, 'sort': sort, 'order': order,
            'doors': [{k: d.get(k) for k in SLIM} for d in rows[offset:offset + limit]]}

@app.get('/api/doors/{door_id}')
def door(door_id: str, territory: str | None = None):
    for d in _doors(territory):
        if d['door_id'] == door_id:
            return d
    raise HTTPException(404)

@app.get('/api/tags')
def tags(territory: str | None = None):
    counts: dict[str, int] = {}
    for d in _doors(territory):
        for t in d.get('tags') or []:
            counts[t] = counts.get(t, 0) + 1
    return {'tags': [{'tag': t, 'count': c} for t, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]}

@app.get('/api/sources')
def sources():
    p = OUT / 'sources.json'
    return json.loads(p.read_text()) if p.exists() else {'sources': []}

@app.get('/api/eval')
def eval_results():
    res = {p.stem.replace('results_', ''): json.loads(p.read_text()) for p in (DATA / 'eval').glob('results_*.json')}
    labels = _labels()
    sat_dir = DATA / 'eval' / 'satellite'
    overhead = {p.stem.replace('results_', ''): json.loads(p.read_text()) for p in sat_dir.glob('results_*.json')} if sat_dir.exists() else {}
    sat_labels = [json.loads(l) for l in (sat_dir / 'labels.jsonl').read_text().splitlines() if l.strip()] if (sat_dir / 'labels.jsonl').exists() else []
    return {'results': res, 'labels': labels, 'n_verified': sum(1 for r in labels if r.get('verified_by_human')),
            'overhead': {'results': overhead, 'n_verified': sum(1 for r in sat_labels if r.get('verified_by_human'))}}

EVAL_MODELS = ('claude-sonnet-5-5', 'claude-haiku-4-5')

def _vision_cache_path(image: Path, model: str) -> Path | None:
    """Locate the cached detector output for an image without ever triggering a model call."""
    from .vision import detect
    helper = getattr(detect, '_cache_path', None)
    if callable(helper):
        try:
            p = helper(str(image), model)
            return p if p.exists() else None
        except TypeError:   # helper signature changed; fall through to the hash match
            pass
    h = hashlib.sha1(image.read_bytes()).hexdigest()[:10]
    return next(iter((CACHE / 'vision').glob(f'{h}_*_{model}.json')), None)

def _prediction_summary(signals: dict) -> dict:
    from .eval.schema import BINARY_SIGNALS, CONDITION_SIGNALS
    out = {'image_usable': signals.get('image_usable')}
    for k in BINARY_SIGNALS:
        s = signals.get(k) or {}
        out[k] = {'present': s.get('present'), 'confidence': s.get('confidence'), 'evidence': s.get('evidence'), 'detail': s.get('detail')}
    for k in CONDITION_SIGNALS: out[k] = signals.get(k)
    out['notes'] = signals.get('notes')
    return out

@app.get('/api/eval/sample')
def eval_sample(verified_only: bool = True):
    """Labels joined with each model's cached prediction. Rows whose cache is missing for a model are
    returned with that model's prediction as null; nothing here can make an API call."""
    from .vision.detect import analyze_image
    rows, skipped = [], 0
    for r in _labels():
        if verified_only and not r.get('verified_by_human'): continue
        image = DATA / 'eval' / r['image']
        if not image.exists(): skipped += 1; continue
        preds = {}
        for m in EVAL_MODELS:
            cached = _vision_cache_path(image, m)
            preds[m] = _prediction_summary(analyze_image(str(image), r['door_id'], model=m)['signals']) if cached else None
        rows.append({**r, 'image_url': f'/api/eval/images/{Path(r["image"]).name}', 'predictions': preds})
    return {'models': list(EVAL_MODELS), 'rows': rows, 'n': len(rows), 'skipped_missing_image': skipped}

_SV_MEM: dict[str, tuple[float, bytes]] = {}
_SV_TTL = 600  # seconds; memory only, never written to disk

def _streetview_bytes(door_id: str) -> bytes:
    hit = _SV_MEM.get(door_id)
    if hit and time.time() - hit[0] < _SV_TTL:
        return hit[1]
    data = _streetview_fetch(door_id)
    if len(_SV_MEM) > 300:
        _SV_MEM.clear()
    _SV_MEM[door_id] = (time.time(), data)
    return data

def _find_door(door_id: str) -> dict | None:
    """Look in the default dataset first, then in every scored custom territory."""
    for d in _doors():
        if d['door_id'] == door_id:
            return d
    for tdir in sorted((DATA / 'territories').glob('*/doors.json'), key=lambda p: -p.stat().st_mtime):
        for d in json.loads(tdir.read_text()):
            if d['door_id'] == door_id:
                return d
    return None

def _streetview_fetch(door_id: str) -> bytes:
    """Fetch one Street View frame from Google at view time. The camera position comes from the
    free metadata endpoint (cached per door); nothing is written to disk and the response is marked
    private, so Google imagery is never stored or redistributed by this project."""
    from .harvest.streetview import pano_metadata, IMG_URL, SIZE, _key
    from .costs import record, STREETVIEW_IMAGE_USD
    door = _find_door(door_id)
    if not door: raise HTTPException(404, 'unknown door')
    try:
        meta = pano_metadata(door)
    except Exception as e:
        raise HTTPException(502, f'imagery metadata unavailable: {e}')
    if meta.get('status') != 'OK': raise HTTPException(404, 'no Street View panorama for this door')
    r = requests.get(IMG_URL, params={'pano': meta['pano_id'], 'location': f'{door["lat"]},{door["lng"]}', 'size': SIZE,
                                      'fov': 80, 'pitch': 5, 'return_error_code': 'true', 'key': _key()}, timeout=30)
    if r.status_code != 200 or not r.headers.get('content-type', '').startswith('image'):
        raise HTTPException(502, 'imagery unavailable')
    record('streetview_view', STREETVIEW_IMAGE_USD, door_id, pano_id=meta['pano_id'])
    return r.content

@app.get('/api/streetview/{door_id}.jpg')
def streetview(door_id: str):
    from fastapi.responses import Response
    return Response(_streetview_bytes(door_id), media_type='image/jpeg',
                    headers={'Cache-Control': 'private, max-age=600'})

@app.get('/api/eval/images/{name}')
def eval_image(name: str):
    # Eval frames are named <door_id>.jpg; they are fetched live like any other frame.
    door_id = Path(name).stem
    from fastapi.responses import Response
    return Response(_streetview_bytes(door_id), media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=600'})

@app.get('/api/ledger')
def ledger(limit: int = 200):
    if not LEDGER.exists(): return {'rows': [], 'total_rows': 0}
    rows = [json.loads(l) for l in LEDGER.read_text().splitlines() if l.strip()]
    return {'rows': rows[-limit:], 'total_rows': len(rows)}

@app.get('/api/stages')
def list_stages():
    active = _active_run()
    return {'stages': stages(), 'active_run': active['id'] if active else None, 'max_spend_usd': MAX_SPEND_USD, 'spent_usd': cost_summary()['total_usd']}

# ---------------------------------------------------------------- runs

class RunRequest(BaseModel):
    limit: int | None = None
    confirm_paid: bool = False

@app.post('/api/run/{stage_id}', dependencies=[Depends(require_token)])
def run_stage(stage_id: str, body: RunRequest):
    st = next((s for s in stages() if s['id'] == stage_id), None)
    if not st: raise HTTPException(404, 'unknown stage')
    active = _active_run()
    if active: raise HTTPException(409, f'a run is already in progress ({active["id"]}: {active["stage"]})')
    if st['needs']: raise HTTPException(400, f'missing keys: {", ".join(st["needs"])}')
    cmd = list(st['cmd'])
    if body.limit and st.get('accepts_limit'): cmd += ['--limit', str(body.limit)]
    est = st['estimate_usd'] if not body.limit else round(min(body.limit, 569) * (EST_STREET + EST_SAT), 2)
    if st['paid']:
        if est > 0 and not body.confirm_paid: raise HTTPException(400, f'paid stage: confirm_paid required (estimate ${est})')
        spent = cost_summary()['total_usd']
        if spent + est > MAX_SPEND_USD:
            raise HTTPException(400, f'spend cap: ${spent:.2f} spent + ${est:.2f} estimate = ${spent + est:.2f} exceeds MAX_SPEND_USD ${MAX_SPEND_USD:.2f}')
    run_id = uuid.uuid4().hex[:8]
    log = RUNS_DIR / f'{run_id}.log'
    with open(log, 'w') as fh:
        proc = subprocess.Popen(cmd, cwd=str(PIPELINE_DIR), stdout=fh, stderr=subprocess.STDOUT, env={**os.environ, 'PYTHONUNBUFFERED': '1'})
    PROCS[run_id] = proc
    RUNS[run_id] = {'id': run_id, 'stage': stage_id, 'cmd': ' '.join(cmd).replace(PY, 'python'), 'started': time.time(), 'ended': None,
                    'status': 'running', 'exit_code': None, 'log': str(log), 'estimate_usd': est, 'pid': proc.pid}
    _save_runs()
    return _public(RUNS[run_id])

# ---------------------------------------------------------------- custom territories (public, free)

TERR_DIR = DATA / 'territories'; TERR_DIR.mkdir(parents=True, exist_ok=True)
NJ_BBOX = (-75.6, 38.8, -73.85, 41.4)
MAX_AREA_KM2 = 12.0

class TerritoryRequest(BaseModel):
    geojson: dict
    name: str | None = None

@app.post('/api/territory', status_code=201)
def create_territory(body: TerritoryRequest):
    """Score any New Jersey polygon from public records plus cached imagery. Never spends: vision runs cache-only."""
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    import hashlib
    g = body.geojson
    try:
        if g.get('type') == 'FeatureCollection':
            geoms = [shape(f['geometry']) for f in g['features']]
        elif g.get('type') == 'Feature':
            geoms = [shape(g['geometry'])]
        else:
            geoms = [shape(g)]
        poly = unary_union(geoms)
    except Exception as e:
        raise HTTPException(400, f'could not read polygon: {e}')
    if poly.is_empty or poly.geom_type not in ('Polygon', 'MultiPolygon'):
        raise HTTPException(400, 'expected a Polygon or MultiPolygon')
    minx, miny, maxx, maxy = poly.bounds
    if not (NJ_BBOX[0] <= minx and maxx <= NJ_BBOX[2] and NJ_BBOX[1] <= miny and maxy <= NJ_BBOX[3]):
        raise HTTPException(400, 'polygon must lie within New Jersey (the parcel source is statewide NJ)')
    import math
    area_km2 = poly.area * 111.32 * 110.57 * math.cos(math.radians((miny + maxy) / 2))
    if area_km2 > MAX_AREA_KM2:
        raise HTTPException(400, f'polygon is {area_km2:.1f} km²; the limit is {MAX_AREA_KM2:.0f} km² (about 5,000 parcels)')
    active = _active_run()
    if active: raise HTTPException(409, f'a run is already in progress ({active["stage"]}); try again in a minute')
    tid = hashlib.sha1(poly.wkb).hexdigest()[:10]
    tdir = TERR_DIR / tid; tdir.mkdir(exist_ok=True)
    name = (body.name or f'Custom territory {tid}')[:80]
    (tdir / 'territory.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'properties': {'name': name, 'area_km2': round(area_km2, 2)}, 'geometry': mapping(poly)}]}))
    cmd = [PY, '-m', 'doorscore.run', '--territory', str(tdir / 'territory.geojson'), '--out', str(tdir), '--vision', '--vision-cache-only']
    run_id = uuid.uuid4().hex[:8]
    log = RUNS_DIR / f'{run_id}.log'
    with open(log, 'w') as fh:
        proc = subprocess.Popen(cmd, cwd=str(PIPELINE_DIR), stdout=fh, stderr=subprocess.STDOUT, env={**os.environ, 'PYTHONUNBUFFERED': '1'})
    PROCS[run_id] = proc
    RUNS[run_id] = {'id': run_id, 'stage': 'territory', 'cmd': ' '.join(cmd).replace(PY, 'python'), 'started': time.time(), 'ended': None,
                    'status': 'running', 'exit_code': None, 'log': str(log), 'estimate_usd': 0.0, 'pid': proc.pid, 'territory_id': tid}
    _save_runs()
    (tdir / 'meta.json').write_text(json.dumps({'territory_id': tid, 'name': name, 'run_id': run_id, 'created': time.time(), 'area_km2': round(area_km2, 2)}))
    return {'territory_id': tid, 'run_id': run_id, 'status': 'running', 'name': name}

@app.get('/api/territory/{tid}')
def get_territory(tid: str):
    tdir = TERR_DIR / Path(tid).name
    if not (tdir / 'meta.json').exists(): raise HTTPException(404, 'unknown territory')
    meta = json.loads((tdir / 'meta.json').read_text())
    r = RUNS.get(meta['run_id'])
    status, tail = 'succeeded' if (tdir / 'doors.geojson').exists() else 'unknown', []
    if r:
        _refresh(r); status = r['status']
        tail = Path(r['log']).read_text().splitlines()[-5:] if Path(r['log']).exists() else []
    report = json.loads((tdir / 'run_report.json').read_text()) if (tdir / 'run_report.json').exists() else None
    return {**meta, 'status': status, 'log_tail': tail, 'report': report}

@app.get('/api/territory/{tid}/{fname}')
def get_territory_file(tid: str, fname: str):
    if fname not in ('doors.geojson', 'territory.geojson', 'doors.json', 'run_report.json'): raise HTTPException(404)
    p = TERR_DIR / Path(tid).name / fname
    if not p.exists(): raise HTTPException(404, 'not ready')
    return FileResponse(p, media_type='application/geo+json' if fname.endswith('.geojson') else 'application/json')

@app.post('/api/runs/{run_id}/cancel', dependencies=[Depends(require_token)])
def cancel_run(run_id: str):
    r = RUNS.get(run_id)
    if not r: raise HTTPException(404)
    _refresh(r)
    if r['status'] != 'running': raise HTTPException(409, f'run is {r["status"]}, not running')
    p = PROCS.get(run_id)
    if p is not None:
        p.terminate()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill(); p.wait(timeout=5)
        r['exit_code'] = p.returncode
        PROCS.pop(run_id, None)
    r['status'] = 'cancelled'; r['ended'] = time.time()
    _save_runs()
    return _public(r)

@app.get('/api/runs')
def runs():
    _active_run()
    return {'runs': sorted((_public(r) for r in RUNS.values()), key=lambda r: -r['started'])}

@app.get('/api/runs/{run_id}')
def run(run_id: str, tail: int = 200):
    r = RUNS.get(run_id)
    if not r: raise HTTPException(404)
    _refresh(r)
    lines = Path(r['log']).read_text().splitlines()[-tail:] if Path(r['log']).exists() else []
    return {**_public(r), 'log_tail': lines}

@app.get('/api/runs/{run_id}/stream')
async def stream(run_id: str, request: Request):
    r = RUNS.get(run_id)
    if not r: raise HTTPException(404)
    async def gen():
        pos = 0
        try:
            while True:
                if await request.is_disconnected(): return
                _refresh(r)
                text = Path(r['log']).read_text() if Path(r['log']).exists() else ''
                if len(text) > pos:
                    for line in text[pos:].splitlines(): yield f'data: {json.dumps({"line": line})}\n\n'
                    pos = len(text)
                if r['status'] != 'running':
                    yield f'data: {json.dumps({"done": True, "status": r["status"], "exit_code": r["exit_code"]})}\n\n'; return
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            return
    return StreamingResponse(gen(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

# ---------------------------------------------------------------- MCP proxy

class RouteRequest(BaseModel):
    hours: float = Field(gt=0, le=12)
    start_point: str | None = None
    min_score: float | None = Field(default=None, ge=0, le=100)
    max_doors: int | None = Field(default=None, ge=1, le=200)
    focus: list[str] | None = None
    include_absentee: bool | None = None

def _mcp_rpc(method: str, params: dict | None = None) -> dict:
    body = {'jsonrpc': '2.0', 'id': uuid.uuid4().hex[:8], 'method': method, 'params': params or {}}
    try:
        resp = requests.post(f'{MCP_URL}/mcp', json=body, timeout=30,
                             headers={'content-type': 'application/json', 'accept': 'application/json, text/event-stream'})
    except requests.RequestException as e:
        raise HTTPException(502, f'MCP server unreachable: {type(e).__name__}')
    if not resp.ok: raise HTTPException(502, f'MCP server returned HTTP {resp.status_code}: {resp.text[:300]}')
    text = resp.text
    if 'text/event-stream' in resp.headers.get('content-type', ''):
        data = next((l[5:].strip() for l in text.splitlines() if l.startswith('data:')), None)
        if data is None: raise HTTPException(502, 'MCP response had no data frame')
        text = data
    try:
        msg = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(502, 'MCP response was not JSON')
    if 'error' in msg: raise HTTPException(502, f'MCP error: {msg["error"].get("message", msg["error"])}')
    return msg.get('result', {})

@app.get('/api/mcp/tools')
def mcp_tools():
    return {'url': f'{MCP_URL}/mcp', 'tools': _mcp_rpc('tools/list').get('tools', [])}

@app.post('/api/route')
def route(body: RouteRequest):
    args = {k: v for k, v in body.model_dump().items() if v is not None}
    result = _mcp_rpc('tools/call', {'name': 'plan_route', 'arguments': args})
    content = result.get('content') or []
    text = next((c.get('text') for c in content if c.get('type') == 'text'), None)
    if text is None: raise HTTPException(502, 'plan_route returned no text content')
    try:
        plan = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(502, 'plan_route returned non-JSON text')
    if result.get('isError'): raise HTTPException(400, plan.get('error', 'plan_route failed') if isinstance(plan, dict) else 'plan_route failed')
    return {'arguments': args, 'plan': plan}

@app.get('/', include_in_schema=False)
def root():
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(
        'Door Score console API\n\n'
        f'Console UI: {WEB_URL}/console\n'
        'Endpoints: /api/health, /api/status, /api/stages, /api/doors, /api/sources, /api/eval, /api/ledger, /api/runs, /api/mcp/tools\n'
        'Interactive docs: /docs\n'
        'Runs (POST /api/run/<stage>) require the X-Console-Token header.\n')

@app.get('/api/health')
def health():
    return {'ok': True, 'doors': len(_doors())}
