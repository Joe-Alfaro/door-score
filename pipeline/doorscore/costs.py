"""Append-only ledger of every paid API call so cost-per-door is measured, not estimated."""
import json, time
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

def record(stage: str, usd: float, door_id: str | None = None, **meta) -> None:
    row = {'ts': time.time(), 'stage': stage, 'door_id': door_id, 'usd': round(usd, 6), **meta}
    with LEDGER.open('a') as f:
        f.write(json.dumps(row) + '\n')

def llm_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pin, pout = MODEL_PRICES.get(model, (5.0, 25.0))
    return input_tokens / 1e6 * pin + output_tokens / 1e6 * pout

PRODUCTION_MODEL = 'claude-sonnet-5-5'

def summary(production_model: str = PRODUCTION_MODEL) -> dict:
    """Production cost per door = imagery + production-model vision, over doors that have imagery.
    Eval and discovery spend are reported separately so they don't inflate the per-door figure."""
    if not LEDGER.exists():
        return {'total_usd': 0, 'by_stage': {}, 'production_usd_per_door': None}
    rows = [json.loads(l) for l in LEDGER.read_text().splitlines() if l.strip()]
    by, by_model = {}, {}
    for r in rows:
        by[r['stage']] = round(by.get(r['stage'], 0) + r['usd'], 4)
        if r.get('model'):
            by_model[r['model']] = round(by_model.get(r['model'], 0) + r['usd'], 4)
    prod = [r for r in rows if r['stage'] == 'streetview_image' or (r['stage'] == 'vision_llm' and r.get('model') == production_model)]
    prod_doors = {r['door_id'] for r in prod if r.get('door_id')}
    prod_usd = round(sum(r['usd'] for r in prod), 4)
    total = round(sum(r['usd'] for r in rows), 4)
    return {'total_usd': total, 'by_stage': by, 'by_model': by_model,
            'production': {'model': production_model, 'usd': prod_usd, 'doors': len(prod_doors),
                           'usd_per_door': round(prod_usd / len(prod_doors), 4) if prod_doors else None},
            'eval_and_discovery_usd': round(total - prod_usd, 4)}
