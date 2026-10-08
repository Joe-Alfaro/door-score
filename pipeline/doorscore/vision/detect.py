"""Extract ICP-relevant signals from one Street View image with a vision model.

Design for honesty over recall: every detection carries a confidence and the visible
evidence that justifies it, and the prompt instructs the model to report absence when
something is not clearly visible. Cached per (image, prompt version, model).
"""
import base64, hashlib, json
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field
import anthropic
from ..config import CACHE
from ..costs import record, llm_cost

PROMPT_VERSION = 'v1'
DEFAULT_MODEL = 'claude-haiku-4-5'   # cheapest tier first; the eval harness decides if we upgrade
OUT_DIR = CACHE / 'vision'
OUT_DIR.mkdir(exist_ok=True)

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
    yard_sign: Detection = Field(description='Lawn sign for a contractor, landscaper, security company, realtor, or similar')
    renovation_activity: Detection = Field(description='Dumpster, scaffolding, construction materials, open permit box')
    professional_landscaping: Detection = Field(description='Crisp bed edging, fresh mulch, uniformly trimmed hedges, striped lawn')
    solar_panels: Detection
    lawn_condition: Condition
    exterior_condition: Condition = Field(description='Paint, siding, trim, gutters')
    roof_condition: Condition
    vehicles_visible: int = Field(ge=0, description='Vehicles in the driveway or directly in front')
    notes: str = Field(description='One sentence; anything else a field rep should know')

SYSTEM = """You analyze a single Google Street View photo of a house for a home-services company.
Report only what is clearly visible in THIS image. If something is not visible, mark it absent with
low confidence and an empty evidence string. Never guess at things that could be present off-frame.
Do not identify people, read license plates, or infer anything about the residents' identity.
Confidence calibration: 0.9+ only when unmistakable; 0.6-0.8 when likely; below 0.5 when unsure.
A provider truck counts only if it is a commercial work vehicle (lettering, ladder rack, trailer, equipment)
positioned at this property, not merely driving past."""

def _cache_path(image_path: str, model: str) -> Path:
    h = hashlib.sha1(open(image_path, 'rb').read()).hexdigest()[:10]
    return OUT_DIR / f'{h}_{PROMPT_VERSION}_{model}.json'

def analyze_image(image_path: str, door_id: str | None = None, model: str = DEFAULT_MODEL,
                  client: anthropic.Anthropic | None = None) -> dict:
    cache = _cache_path(image_path, model)
    if cache.exists():
        return json.loads(cache.read_text())
    client = client or anthropic.Anthropic()
    data = base64.standard_b64encode(open(image_path, 'rb').read()).decode()
    resp = client.messages.parse(
        model=model, max_tokens=1500, system=SYSTEM,
        messages=[{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': data}},
            {'type': 'text', 'text': 'Analyze this property frontage.'}]}],
        output_format=StreetViewSignals,
    )
    usage = resp.usage
    usd = llm_cost(model, usage.input_tokens, usage.output_tokens)
    record('vision_llm', usd, door_id, model=model, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)
    out = {'model': model, 'prompt_version': PROMPT_VERSION, 'usd': round(usd, 6),
           'signals': resp.parsed_output.model_dump()}
    cache.write_text(json.dumps(out, indent=1))
    return out
