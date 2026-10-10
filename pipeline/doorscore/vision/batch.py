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
MAX_BATCH_BYTES = 150 * 1024 * 1024   # API limit is 256 MB per batch; base64 images add ~33%


def chunk_items(items: list[dict]) -> list[list[dict]]:
    """Split items so each batch's base64 payload stays well under the API's size limit."""
    chunks, cur, size = [], [], 0
    for it in items:
        b = int(Path(it['image_path']).stat().st_size * 1.37) + 4096
        if cur and size + b > MAX_BATCH_BYTES:
            chunks.append(cur); cur, size = [], 0
        cur.append(it); size += b
    if cur:
        chunks.append(cur)
    return chunks


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
    batches = []
    for chunk in chunk_items(items):
        requests = build_requests(chunk, model, system, user_text, schema)
        batch = client.messages.batches.create(requests=requests)
        batches.append(batch)
        log(f'[{stage}] batch {batch.id}: {len(requests)} requests submitted')
    log(f'[{stage}] {len(batches)} batch(es), {len(items)} requests, est. ${len(items) * expected_usd_per_call:.2f} at batch rate')
    t0 = time.time()
    pending = list(batches)
    while pending:
        if time.time() - t0 > MAX_WAIT_SECONDS:
            raise TimeoutError(f'{len(pending)} batch(es) still processing after 24h; results stay retrievable for 29 days')
        time.sleep(poll_seconds)
        still = []
        for b in pending:
            b = client.messages.batches.retrieve(b.id)
            c = b.request_counts
            log(f'[{stage}] batch {b.id}: {b.processing_status}, processing {c.processing}, done {c.succeeded}, errored {c.errored}')
            if b.processing_status != 'ended':
                still.append(b)
        pending = still
    by_id = {it['custom_id']: it for it in items}
    out, budget_error = {}, None
    def _all_results():
        for b in batches:
            yield from client.messages.batches.results(b.id)
    for result in _all_results():
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
