"""Message Batches path for the vision stages: every uncached image of a stage goes up as one batch,
is billed at 50% of list price, and lands in the same cache files the synchronous path writes.

Opt in with `VISION_BATCH=1` (or `batch=True` on run_vision / run_satellite). Nobody is waiting on a
territory run, so the only cost of batching is wall-clock: most batches finish within an hour, the
API allows up to 24 h. Structured output is preserved by sending the same JSON schema
`messages.parse` would send (`output_config.format`) and validating each result with the same
Pydantic model.
"""
import json, time
from pathlib import Path
from pydantic import BaseModel, ValidationError
from ..costs import record, llm_cost, ensure_budget, BudgetExceeded
from .common import message_params, result_record, store, usage_dict

POLL_SECONDS = 30
MAX_WAIT_SECONDS = 24 * 3600


def output_format(schema: type[BaseModel]) -> dict:
    """The exact `output_config.format` block messages.parse() derives from a Pydantic model."""
    try:
        from anthropic.lib._parse._transform import transform_schema
        json_schema = transform_schema(schema)
    except ImportError:  # SDK layout changed: fall back to pydantic's schema, which the API also accepts
        json_schema = schema.model_json_schema()
    return {'type': 'json_schema', 'schema': json_schema}


def build_requests(items: list[dict], model: str, system: str, user_text: str, schema: type[BaseModel]) -> list[dict]:
    """One Batches `Request` per item. items: [{custom_id, image_path, ...}]. Pure: no network."""
    fmt = output_format(schema)
    return [{'custom_id': it['custom_id'],
             'params': {**message_params(it['image_path'], model, system, user_text), 'output_config': {'format': fmt}}}
            for it in items]


def _text(message) -> str:
    return next((b.text for b in message.content if b.type == 'text'), '')


def run_batch(*, stage: str, items: list[dict], model: str, system: str, user_text: str, schema: type[BaseModel],
              prompt_version: str, expected_usd_per_call: float, client=None, poll_seconds: int = POLL_SECONDS,
              log=print) -> dict[str, dict]:
    """Submit, poll, write caches, record cost at the batch rate. Returns {custom_id: result}.
    items: [{custom_id, image_path, door_id, cache_paths: [Path]}].
    Raises BudgetExceeded *before submitting* if the estimate would cross the cap; if the cap is
    crossed while results are being recorded (the money is already spent), every result is still
    cached and ledgered, then BudgetExceeded is raised once at the end."""
    if not items:
        return {}
    ensure_budget(len(items) * expected_usd_per_call)
    import anthropic
    client = client or anthropic.Anthropic()
    requests = build_requests(items, model, system, user_text, schema)
    batch = client.messages.batches.create(requests=requests)
    log(f'[{stage}] batch {batch.id}: {len(requests)} requests submitted (est. ${len(items) * expected_usd_per_call:.2f} at batch rate)')
    t0 = time.time()
    while batch.processing_status != 'ended':
        if time.time() - t0 > MAX_WAIT_SECONDS:
            raise TimeoutError(f'batch {batch.id} still {batch.processing_status} after 24h; results stay retrievable for 29 days')
        time.sleep(poll_seconds)
        batch = client.messages.batches.retrieve(batch.id)
        c = batch.request_counts
        log(f'[{stage}] batch {batch.id}: {batch.processing_status}, processing {c.processing}, done {c.succeeded}, errored {c.errored}')
    by_id = {it['custom_id']: it for it in items}
    out, budget_error = {}, None
    for result in client.messages.batches.results(batch.id):
        it = by_id.get(result.custom_id)
        if not it:
            continue
        if result.result.type != 'succeeded':
            err = getattr(result.result, 'error', None)
            log(f'[{stage}] {result.custom_id}: {result.result.type} {getattr(err, "type", "") if err else ""}')
            continue
        msg = result.result.message
        try:
            signals = schema.model_validate_json(_text(msg))
        except ValidationError as e:
            log(f'[{stage}] {result.custom_id}: unparseable structured output ({e.error_count()} errors); skipped')
            continue
        usage = usage_dict(msg.usage)
        usd = llm_cost(model, batch=True, **usage)
        rec = result_record(model, prompt_version, usd, signals, batch=True, batch_id=batch.id)
        store(it['cache_paths'], rec)
        out[result.custom_id] = rec
        try:
            record(stage, usd, it.get('door_id'), model=model, batch=True, batch_id=batch.id, **usage)
        except BudgetExceeded as e:
            budget_error = e
    log(f'[{stage}] batch {batch.id}: {len(out)}/{len(items)} results cached, ${sum(r["usd"] for r in out.values()):.2f}')
    if budget_error:
        raise budget_error
    return out
