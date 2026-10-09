"""Shared plumbing for the two vision detectors: one request builder for the synchronous and the
batch path, one cache format, and the pay-once contract (write the cache before the ledger row).

Cache files are plain JSON `{model, prompt_version, usd, signals, ...}`; a result may be stored under
several keys (metadata key + legacy image-hash key) so it can be found with or without the image file.
"""
import base64, hashlib, json
from pathlib import Path
from pydantic import BaseModel
from ..costs import record, llm_cost, ensure_budget

MAX_TOKENS = 1500


def image_hash(image_path: str) -> str:
    return hashlib.sha1(Path(image_path).read_bytes()).hexdigest()[:10]


def media_type(image_path: str) -> str:
    return 'image/png' if image_path.lower().endswith('.png') else 'image/jpeg'


def load_cached(paths: list[Path]) -> dict | None:
    for p in paths:
        if p.exists():
            return json.loads(p.read_text())
    return None


def store(paths: list[Path], out: dict) -> None:
    for p in paths:
        p.write_text(json.dumps(out, indent=1))


def message_params(image_path: str, model: str, system: str, user_text: str) -> dict:
    """Body shared by messages.parse and a Message Batches request (minus output_config).
    The system block carries a cache breakpoint: it is byte-identical across every call of a run,
    so a hit re-bills it at 0.1x on models whose cacheable minimum it reaches."""
    data = base64.standard_b64encode(Path(image_path).read_bytes()).decode()
    return {
        'model': model, 'max_tokens': MAX_TOKENS,
        'system': [{'type': 'text', 'text': system, 'cache_control': {'type': 'ephemeral'}}],
        'messages': [{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': media_type(image_path), 'data': data}},
            {'type': 'text', 'text': user_text}]}],
    }


def result_record(model: str, prompt_version: str, usd: float, signals: BaseModel, **extra) -> dict:
    return {'model': model, 'prompt_version': prompt_version, 'usd': round(usd, 6), 'signals': signals.model_dump(), **extra}


def analyze_sync(*, image_path: str, model: str, system: str, user_text: str, schema: type[BaseModel],
                 prompt_version: str, stage: str, door_id: str | None, cache_paths: list[Path],
                 client=None, expected_usd: float = 0.0) -> dict:
    """One structured-output call. Checks the budget first, writes the cache before the ledger row so a
    paid result is never lost, then lets `record()` raise BudgetExceeded if the cap was crossed."""
    cached = load_cached(cache_paths)
    if cached:
        return cached
    ensure_budget(expected_usd)
    import anthropic
    client = client or anthropic.Anthropic()
    resp = client.messages.parse(**message_params(image_path, model, system, user_text), output_format=schema)
    usage = usage_dict(resp.usage)
    usd = llm_cost(model, **usage)
    out = result_record(model, prompt_version, usd, resp.parsed_output)
    store(cache_paths, out)
    record(stage, usd, door_id, model=model, **usage)
    return out


def usage_dict(usage) -> dict:
    """The four billable meters from a response `usage` object, as llm_cost()/record() kwargs."""
    return {'input_tokens': usage.input_tokens, 'output_tokens': usage.output_tokens,
            'cache_read_tokens': getattr(usage, 'cache_read_input_tokens', None) or 0,
            'cache_write_tokens': getattr(usage, 'cache_creation_input_tokens', None) or 0}
