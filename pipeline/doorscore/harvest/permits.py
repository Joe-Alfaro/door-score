"""NJ DCA construction permits (statewide, Socrata open data) joined to parcels on
municipality code + block + lot. Discovered by the source-discovery agent.

Permitted work is, by definition, contractor work: a strong 'hires out' signal, plus a
'recently invested' timeline. No people are named in this dataset.
"""
import json
from collections import defaultdict
import requests
from ..config import CACHE, AS_OF_YEAR, AS_OF_MONTH

URL = 'https://data.nj.gov/resource/w9se-dmra.json'
FIELDS = 'comu,block,lot,permitdate,permittypedesc,permitstatusdesc,constcost,buildfee,plumbfee,electfee,firefee,usegroupdesc'
PAGE = 5000
PERMITS_DIR = CACHE / 'permits'; PERMITS_DIR.mkdir(exist_ok=True)

def fetch_municipality(comu: str) -> list[dict]:
    p = PERMITS_DIR / f'{comu}.json'
    if p.exists():
        return json.loads(p.read_text())
    rows, offset = [], 0
    while True:
        r = requests.get(URL, params={'comu': comu, '$select': FIELDS, '$limit': PAGE, '$offset': offset,
                                      '$order': 'permitdate'}, timeout=120)
        r.raise_for_status()
        page = r.json()
        rows += page
        if len(page) < PAGE:
            break
        offset += PAGE
    p.write_text(json.dumps(rows))
    return rows

def _months_ago(iso: str) -> int:
    y, m = int(iso[:4]), int(iso[5:7])
    return (AS_OF_YEAR - y) * 12 + (AS_OF_MONTH - m)

def _num(v) -> float:
    try: return float(v or 0)
    except ValueError: return 0.0

def summarize(rows: list[dict]) -> dict:
    """Per-door permit profile. Only permits in the last 10 years are considered."""
    recent = [r for r in rows if r.get('permitdate') and _months_ago(r['permitdate']) <= 120]
    recent.sort(key=lambda r: r['permitdate'], reverse=True)
    last5 = [r for r in recent if _months_ago(r['permitdate']) <= 60]
    trades = set()
    for r in last5:
        if _num(r.get('plumbfee')): trades.add('plumbing')
        if _num(r.get('electfee')): trades.add('electrical')
        if _num(r.get('buildfee')): trades.add('building')
        if _num(r.get('firefee')): trades.add('fire')
    latest = recent[0] if recent else None
    return {
        'permits_10yr': len(recent),
        'permits_5yr': len(last5),
        'cost_5yr': round(sum(_num(r.get('constcost')) for r in last5)),
        'trades_5yr': sorted(trades),
        'latest_date': latest['permitdate'][:10] if latest else None,
        'latest_type': latest['permittypedesc'] if latest else None,
        'latest_cost': round(_num(latest.get('constcost'))) if latest else None,
        'months_since_latest': _months_ago(latest['permitdate']) if latest else None,
        'major_project_5yr': any(_num(r.get('constcost')) >= 25000 for r in last5),
    }

def enrich(doors: list[dict]) -> list[dict]:
    comus = {d['door_id'].split('_')[0] for d in doors}
    by_key = defaultdict(list)
    for comu in sorted(comus):
        for r in fetch_municipality(comu):
            by_key[(comu, (r.get('block') or '').strip().upper(), (r.get('lot') or '').strip().upper())].append(r)
    hits = 0
    for d in doors:
        comu, block, lot = d['door_id'].split('_')[:3]
        rows = by_key.get((comu, block.upper(), lot.upper()), [])
        d['permits'] = summarize(rows)
        hits += bool(rows)
    print(f'[permits] {hits}/{len(doors)} doors matched to permit records across {len(comus)} municipalities')
    return doors
