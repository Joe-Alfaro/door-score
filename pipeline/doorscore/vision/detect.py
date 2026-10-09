"""Extract ICP-relevant signals from one Street View image with a vision model.

Design for honesty over recall: every detection carries a confidence and the visible
evidence that justifies it, and the prompt instructs the model to report absence when
something is not clearly visible.

Cache keys. Results are stored under a metadata key `(door_id, pano_id, prompt version, model)`
built from the free Street View metadata, so a cached result is reusable without the 230 MB of
image files; the legacy image-hash key `(sha1(image), prompt version, model)` is kept as a fallback
and is what the eval harness and the API console use for images outside the territory flow.

Prompt versions. `v2` is production. `v3` is the output-token diet (same fields, shorter
free text); select it with `VISION_PROMPT_VERSION=v3`. Each version has its own cache namespace.
"""
import os
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field
from ..config import CACHE
from .common import analyze_sync, image_hash, load_cached

DEFAULT_MODEL = 'claude-sonnet-5-5'  # chosen by the eval harness: Haiku hallucinated landscaping on 32% and yard signs on 21% of negatives; Sonnet ~0-2%
OUT_DIR = CACHE / 'vision'
OUT_DIR.mkdir(exist_ok=True)
STAGE = 'vision_llm'
USER_TEXT = 'Analyze this property frontage.'

Condition = Literal['poor', 'fair', 'good', 'excellent', 'not_visible']

class Detection(BaseModel):
    present: bool
    confidence: float = Field(ge=0, le=1, description='0-1; use <0.5 when unsure')
    evidence: str = Field(description='What in the image supports this. Empty string if not present.')
    detail: str | None = Field(default=None, description='Type/company/wording if legible, else null')

class StreetViewSignals(BaseModel):
    image_usable: bool = Field(description='False if the image does not clearly show a residential property frontage')
    usability_note: str
    provider_truck: Detection = Field(description='Home-service provider vehicle (landscaping, pool, HVAC, plumbing, roofing, cleaning, pest, painting) parked at or in front of THIS property')
    yard_sign: Detection = Field(description='Lawn sign for a contractor, landscaper, security company, or political/other; put the company or wording in detail')
    moving_indicators: Detection = Field(description='Evidence a household is moving in or out: PODS or other storage container, moving truck, For Sale / Sold / Under Contract sign, piles of moving boxes')
    renovation_activity: Detection = Field(description='Dumpster, scaffolding, construction materials, open permit box')
    professional_landscaping: Detection = Field(description='Grounds that clearly required a paid crew: at least two of crisp bed edging, fresh uniform mulch, sculpted/shaped hedges, striped mowing pattern, irrigation heads, stone hardscape beds. An ordinary tidy suburban lawn does NOT count')
    solar_panels: Detection
    lawn_condition: Condition
    exterior_condition: Condition = Field(description='Paint, siding, trim, gutters')
    roof_condition: Condition
    vehicles_visible: int = Field(ge=0, description='Vehicles in the driveway or directly in front')
    notes: str = Field(description='One sentence; anything else a field rep should know')

SYSTEM_V2 = """You analyze a single Google Street View photo of a house for a home-services company.
Report only what is clearly visible in THIS image. If something is not visible, mark it absent with
low confidence and an empty evidence string. Never guess at things that could be present off-frame.
Do not identify people, read license plates, or infer anything about the residents' identity.
Confidence calibration: 0.9+ only when unmistakable; 0.6-0.8 when likely; below 0.5 when unsure.
A provider truck counts only if it is a commercial work vehicle (lettering, ladder rack, trailer, equipment)
positioned at this property, not merely driving past. Moving containers and moving trucks are
moving_indicators, not provider trucks. Be conservative with professional_landscaping: most
well-kept lawns in a suburb are homeowner-maintained; mark present only with clear crew-level evidence."""

# v3 = v2 + an output-length contract. Field names and types are unchanged, so every downstream
# reader works; only the free-text fields get shorter (they are ~45% of what we pay per call).
SYSTEM_V3 = SYSTEM_V2 + """
Output length rules, strictly: when present=false, evidence is exactly "" (never explain an absence).
When present=true, evidence is one clause of at most 12 words naming the visible object.
detail is at most 6 words or null. usability_note is at most 8 words. notes is one sentence of at
most 15 words, or "" when there is nothing a field rep needs to know."""

SYSTEMS = {'v2': SYSTEM_V2, 'v3': SYSTEM_V3}
PROMPT_VERSION = os.getenv('VISION_PROMPT_VERSION', 'v2')
if PROMPT_VERSION not in SYSTEMS:
    raise RuntimeError(f'VISION_PROMPT_VERSION={PROMPT_VERSION!r}; known: {sorted(SYSTEMS)}')
SYSTEM = SYSTEMS[PROMPT_VERSION]


def _cache_path(image_path: str, model: str) -> Path:
    """Legacy key: needs the image bytes. Kept for the eval harness and the API console."""
    return OUT_DIR / f'{image_hash(image_path)}_{PROMPT_VERSION}_{model}.json'

def meta_cache_path(door_id: str, pano_id: str, model: str, prompt_version: str = PROMPT_VERSION) -> Path:
    """Metadata key: resolvable from the free Street View metadata alone."""
    return OUT_DIR / f'{door_id}+{pano_id}_{prompt_version}_{model}.json'

def cache_paths(door_id: str | None, pano_id: str | None, model: str, image_path: str | None) -> list[Path]:
    """Every key a result for this door may live under, metadata key first."""
    paths = []
    if door_id and pano_id:
        paths.append(meta_cache_path(door_id, pano_id, model))
    if image_path and Path(image_path).exists():
        paths.append(_cache_path(image_path, model))
    return paths

def cached_result(door_id: str | None, pano_id: str | None, model: str, image_path: str | None = None) -> dict | None:
    """Cached detector output if any key hits; never calls any API."""
    return load_cached(cache_paths(door_id, pano_id, model, image_path))

def analyze_image(image_path: str, door_id: str | None = None, model: str = DEFAULT_MODEL,
                  client=None, pano_id: str | None = None, expected_usd: float = 0.0) -> dict:
    paths = cache_paths(door_id, pano_id, model, image_path)
    cached = load_cached(paths)
    if cached:
        return cached
    if not Path(image_path).exists():
        raise FileNotFoundError(f'{image_path}: no cached vision result and no image to analyze')
    return analyze_sync(image_path=image_path, model=model, system=SYSTEM, user_text=USER_TEXT,
                        schema=StreetViewSignals, prompt_version=PROMPT_VERSION, stage=STAGE, door_id=door_id,
                        cache_paths=paths or [_cache_path(image_path, model)], client=client, expected_usd=expected_usd)
