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

def summary() -> dict:
    if not LEDGER.exists():
        return {'total_usd': 0, 'by_stage': {}, 'doors_with_spend': 0}
    rows = [json.loads(l) for l in LEDGER.read_text().splitlines() if l.strip()]
    by = {}
    for r in rows:
        by[r['stage']] = round(by.get(r['stage'], 0) + r['usd'], 4)
    doors = {r['door_id'] for r in rows if r.get('door_id')}
    total = round(sum(r['usd'] for r in rows), 4)
    return {'total_usd': total, 'by_stage': by, 'doors_with_spend': len(doors),
            'usd_per_door': round(total / len(doors), 4) if doors else None}
