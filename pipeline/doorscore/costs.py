"""Append-only ledger of every paid API call so cost-per-door is measured, not estimated.

Also the hard spend cap: `record()` raises `BudgetExceeded` once the ledger total passes
`MAX_SPEND_USD` (env, default 45). The row is still written first, because by the time `record()`
runs the call has already been paid for; the exception exists so callers stop making the next one.

`python -m doorscore.costs` prints the spend analysis (by stage/model, per-call token profile).
"""
import json, os, statistics, threading, time
from .config import CACHE

LEDGER = CACHE / 'cost_ledger.jsonl'

# USD per 1M tokens (input, output). Anthropic first-party list prices.
MODEL_PRICES = {
    'claude-haiku-4-5': (1.00, 5.00),
    'claude-sonnet-5-5': (2.00, 10.00),
    'claude-opus-5-5': (4.00, 20.00),
}
STREETVIEW_IMAGE_USD = 0.007     # Street View Static API, $7 per 1k images
STATIC_MAP_IMAGE_USD = 0.002     # Maps Static API, $2 per 1k images
BATCH_DISCOUNT = 0.5             # Message Batches bill every token at 50% of list price

MAX_SPEND_USD = float(os.getenv('MAX_SPEND_USD', '45'))

# Token profile measured on this territory (mean input/output per call, Sonnet 5.5, 640x640 images).
# Used to price a model that has no ledger history yet, e.g. Haiku on satellite tiles.
MEASURED_TOKENS = {'vision_llm': (2128, 421), 'satellite_vision_llm': (2064, 346)}
VISION_STAGES = ('vision_llm', 'satellite_vision_llm')


class BudgetExceeded(RuntimeError):
    """The ledger total has passed MAX_SPEND_USD. Stop making paid calls."""


_lock = threading.Lock()
_total: float | None = None


def _rows() -> list[dict]:
    if not LEDGER.exists():
        return []
    return [json.loads(l) for l in LEDGER.read_text().splitlines() if l.strip()]


def total_spend() -> float:
    """Ledger total, loaded once per process then kept current by record()."""
    global _total
    with _lock:
        if _total is None:
            _total = sum(r['usd'] for r in _rows())
        return _total


def ensure_budget(expected_usd: float = 0.0) -> None:
    """Raise before a paid call if it would push the ledger past the cap."""
    spent = total_spend()
    if spent + expected_usd > MAX_SPEND_USD:
        raise BudgetExceeded(f'spend cap: ${spent:.2f} spent + ${expected_usd:.4f} expected > MAX_SPEND_USD ${MAX_SPEND_USD:.2f}')


def record(stage: str, usd: float, door_id: str | None = None, **meta) -> None:
    """Append one paid call. Writes the row, then raises BudgetExceeded if the running total passed the cap."""
    global _total
    row = {'ts': time.time(), 'stage': stage, 'door_id': door_id, 'usd': round(usd, 6), **meta}
    with _lock:
        if _total is None:
            _total = sum(r['usd'] for r in _rows())
        with LEDGER.open('a') as f:
            f.write(json.dumps(row) + '\n')
        _total += row['usd']
        over = _total > MAX_SPEND_USD
        spent = _total
    if over:
        raise BudgetExceeded(f'spend cap reached: ledger total ${spent:.2f} > MAX_SPEND_USD ${MAX_SPEND_USD:.2f}')


CACHE_WRITE_MULT = 1.25                       # 5-minute cache write, relative to input price
CACHE_READ_MULT = {'claude-opus-5-5': 0.05}   # cache read, relative to input price; 0.1 elsewhere


def llm_cost(model: str, input_tokens: int, output_tokens: int, batch: bool = False,
             cache_read_tokens: int | None = None, cache_write_tokens: int | None = None) -> float:
    """USD for one call. `input_tokens` is the uncached input (what `usage.input_tokens` reports when a
    cache breakpoint is set); cached reads/writes are priced at their multipliers."""
    pin, pout = MODEL_PRICES.get(model, (5.0, 25.0))
    usd = input_tokens / 1e6 * pin + output_tokens / 1e6 * pout
    usd += (cache_read_tokens or 0) / 1e6 * pin * CACHE_READ_MULT.get(model, 0.1)
    usd += (cache_write_tokens or 0) / 1e6 * pin * CACHE_WRITE_MULT
    return usd * BATCH_DISCOUNT if batch else usd


PRODUCTION_MODEL = 'claude-sonnet-5-5'


def summary(production_model: str = PRODUCTION_MODEL) -> dict:
    """Production cost per door = imagery + production-model vision, over doors that have imagery.
    Eval and discovery spend are reported separately so they don't inflate the per-door figure."""
    rows = _rows()
    if not rows:
        return {'total_usd': 0, 'by_stage': {}, 'production_usd_per_door': None}
    by, by_model = {}, {}
    for r in rows:
        by[r['stage']] = round(by.get(r['stage'], 0) + r['usd'], 4)
        if r.get('model'):
            by_model[r['model']] = round(by_model.get(r['model'], 0) + r['usd'], 4)
    prod = [r for r in rows if r['stage'] in ('streetview_image', 'satellite_image')
            or (r['stage'] in VISION_STAGES and r.get('model') == production_model)]
    prod_doors = {r['door_id'] for r in prod if r.get('door_id')}
    prod_usd = round(sum(r['usd'] for r in prod), 4)
    total = round(sum(r['usd'] for r in rows), 4)
    return {'total_usd': total, 'by_stage': by, 'by_model': by_model,
            'production': {'model': production_model, 'usd': prod_usd, 'doors': len(prod_doors),
                           'usd_per_door': round(prod_usd / len(prod_doors), 4) if prod_doors else None},
            'eval_and_discovery_usd': round(total - prod_usd, 4), 'max_spend_usd': MAX_SPEND_USD}


# ---- Per-call rates and the pre-run estimate ---------------------------------------------

def per_call_rate(stage: str, model: str, batch: bool = False) -> float:
    """Measured mean USD per call for (stage, model) from the ledger, at standard (non-batch) prices;
    falls back to the measured token profile x list price when the ledger has no such calls."""
    rows = [r for r in _rows() if r['stage'] == stage and r.get('model') == model
            and r.get('input_tokens') is not None and not r.get('batch')]
    if rows:
        usd = statistics.mean(r['usd'] for r in rows)
    else:
        tin, tout = MEASURED_TOKENS.get(stage, (2100, 400))
        usd = llm_cost(model, tin, tout)
    return usd * BATCH_DISCOUNT if batch else usd


def estimate_vision_cost(doors: list[dict], model: str = PRODUCTION_MODEL, satellite: bool = True,
                         batch: bool = False) -> dict:
    """What `run --vision` would spend on these doors right now: uncached doors x measured per-door
    rates, plus imagery for doors whose image is not on disk. Never calls any API; the Street View
    metadata is read from its cache only (doors without cached metadata are assumed to have imagery)."""
    from .vision import detect, satellite_detect
    from .harvest.streetview import META_DIR, IMG_DIR as SV_DIR
    from .harvest import satellite as sat_harvest
    out = {'model': model, 'batch': batch, 'doors': len(doors), 'stages': {}}
    sv_uncached = sv_images_missing = 0
    for d in doors:
        meta_p = META_DIR / f'{d["door_id"]}.json'
        meta = json.loads(meta_p.read_text()) if meta_p.exists() else {'status': 'OK'}
        if meta.get('status') != 'OK':
            continue
        img = SV_DIR / f'{d["door_id"]}.jpg'
        if detect.cached_result(d['door_id'], meta.get('pano_id'), model, str(img) if img.exists() else None):
            continue
        sv_uncached += 1
        sv_images_missing += 0 if img.exists() else 1
    rate = per_call_rate('vision_llm', model, batch)
    out['stages']['street'] = {'uncached_calls': sv_uncached, 'images_to_fetch': sv_images_missing,
                               'usd_per_call': round(rate, 5),
                               'llm_usd': round(sv_uncached * rate, 4),
                               'imagery_usd': round(sv_images_missing * STREETVIEW_IMAGE_USD, 4)}
    if satellite:
        sat_uncached = sat_images_missing = 0
        for d in doors:
            img = sat_harvest._cached(d['door_id'])
            if satellite_detect.cached_result(d['door_id'], sat_harvest.ZOOM, model, str(img) if img else None):
                continue
            sat_uncached += 1
            sat_images_missing += 0 if img else 1
        rate = per_call_rate('satellite_vision_llm', model, batch)
        out['stages']['satellite'] = {'uncached_calls': sat_uncached, 'images_to_fetch': sat_images_missing,
                                      'usd_per_call': round(rate, 5),
                                      'llm_usd': round(sat_uncached * rate, 4),
                                      'imagery_usd': round(sat_images_missing * STATIC_MAP_IMAGE_USD, 4)}
    out['total_usd'] = round(sum(s['llm_usd'] + s['imagery_usd'] for s in out['stages'].values()), 4)
    out['spent_usd'] = round(total_spend(), 4)
    out['max_spend_usd'] = MAX_SPEND_USD
    out['fits_budget'] = out['spent_usd'] + out['total_usd'] <= MAX_SPEND_USD
    return out


# ---- Spend analysis ---------------------------------------------------------------------

def analyze_ledger() -> dict:
    """Spend by stage/model plus the per-call token profile for every vision (stage, model) pair."""
    rows = _rows()
    by = {}
    for r in rows:
        k = (r['stage'], r.get('model') or '-')
        agg = by.setdefault(k, {'calls': 0, 'usd': 0.0})
        agg['calls'] += 1
        agg['usd'] += r['usd']
    profile = {}
    for (stage, model), agg in by.items():
        calls = [r for r in rows if r['stage'] == stage and r.get('model') == model and r.get('input_tokens') is not None]
        if not calls or model not in MODEL_PRICES:
            continue
        pin, pout = MODEL_PRICES[model]
        tin = [r['input_tokens'] for r in calls]
        tout = [r['output_tokens'] for r in calls]
        in_usd = sum(tin) / 1e6 * pin
        out_usd = sum(tout) / 1e6 * pout
        profile[(stage, model)] = {
            'calls': len(calls), 'mean_in': round(statistics.mean(tin)), 'mean_out': round(statistics.mean(tout)),
            'p90_out': sorted(tout)[int(0.9 * (len(tout) - 1))], 'max_out': max(tout),
            'in_usd': round(in_usd, 4), 'out_usd': round(out_usd, 4),
            'out_share': round(out_usd / (in_usd + out_usd), 3), 'usd_per_call': round((in_usd + out_usd) / len(calls), 5)}
    return {'total_usd': round(sum(r['usd'] for r in rows), 4), 'rows': len(rows),
            'by_stage_model': {k: {'calls': v['calls'], 'usd': round(v['usd'], 4)} for k, v in sorted(by.items(), key=lambda kv: -kv[1]['usd'])},
            'token_profile': profile}


def _print_analysis() -> None:
    a = analyze_ledger()
    print(f'ledger: {a["rows"]} rows, ${a["total_usd"]:.2f} total (cap ${MAX_SPEND_USD:.0f})\n')
    print('| stage | model | calls | USD | share |')
    print('|---|---|---:|---:|---:|')
    for (stage, model), v in a['by_stage_model'].items():
        print(f'| {stage} | {model} | {v["calls"]} | {v["usd"]:.2f} | {100 * v["usd"] / a["total_usd"]:.0f}% |')
    print('\n| stage | model | calls | mean in | mean out | p90 out | input $ | output $ | output share | $/call |')
    print('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|')
    for (stage, model), p in a['token_profile'].items():
        print(f'| {stage} | {model} | {p["calls"]} | {p["mean_in"]} | {p["mean_out"]} | {p["p90_out"]} | '
              f'{p["in_usd"]:.2f} | {p["out_usd"]:.2f} | {100 * p["out_share"]:.0f}% | {p["usd_per_call"]:.5f} |')


if __name__ == '__main__':
    _print_analysis()
