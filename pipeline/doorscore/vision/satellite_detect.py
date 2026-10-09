"""Extract ICP-relevant signals from one overhead satellite tile with a vision model.

Same honesty contract as the Street View detector: every detection carries a confidence and
the visible evidence behind it, and absence is reported as absence. Cached per
(image hash, prompt version, model).
"""
import base64, hashlib, json
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field
import anthropic
from ..config import CACHE
from ..costs import record, llm_cost
from .detect import Detection

PROMPT_VERSION = 'sat-v1'
DEFAULT_MODEL = 'claude-sonnet-5-5'
OUT_DIR = CACHE / 'vision_satellite'
OUT_DIR.mkdir(exist_ok=True)

RoofCondition = Literal['poor', 'fair', 'good', 'excellent', 'not_visible']
TreeCover = Literal['low', 'medium', 'high']

class SatelliteSignals(BaseModel):
    image_usable: bool = Field(description='False if the tile does not clearly show a single-family residential lot (cloud, blur, no roof, apartment block, commercial)')
    swimming_pool: Detection = Field(description='In-ground or above-ground pool on THIS lot (the one at image center); put in-ground/above-ground and whether covered in detail')
    solar_panels: Detection = Field(description='Photovoltaic array on the roof of the central house; put approximate panel count or roof face in detail')
    play_equipment: Detection = Field(description='Trampoline, playset, swing set, or playhouse in the yard of the central lot')
    detached_structure: Detection = Field(description='Shed, detached garage, pool house, or similar outbuilding on the central lot; name the type in detail')
    driveway_vehicles: int = Field(ge=0, description='Vehicles visible in the driveway of the central lot (not on the street)')
    roof_condition: RoofCondition = Field(description='Staining, missing shingles, patching, moss, sag vs. uniform clean roofing on the central house')
    tree_cover: TreeCover = Field(description='Mature tree canopy on the central lot: low (open lawn), medium, high (canopy hides much of the yard)')
    notes: str = Field(description='One sentence; anything else a field rep should know about this lot from above')

SYSTEM = """You analyze a single overhead satellite tile centered on one residential lot for a home-services company.
Report only what is clearly visible from above in THIS image, and only for the lot at the center of the tile;
neighboring lots at the edges do not count. If something is not visible, mark it absent with low confidence
and an empty evidence string. Never guess at what might be hidden under tree canopy or shadow.
Never identify people; if people are visible, ignore them entirely.
Confidence calibration: 0.9+ only when unmistakable; 0.6-0.8 when likely; below 0.5 when unsure.
A pool is a rectangular or kidney-shaped blue/turquoise water surface, or a clearly pool-shaped cover.
Solar panels are regular dark rectangular grids on a roof face; skylights and dark shingles do NOT count.
A trampoline is a round dark disc with a lighter rim; a shadow, fire pit, or round patio is NOT one.
Roof condition is 'not_visible' when canopy or resolution prevents a judgment."""

def _media_type(image_path: str) -> str:
    return 'image/png' if image_path.lower().endswith('.png') else 'image/jpeg'

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
            {'type': 'image', 'source': {'type': 'base64', 'media_type': _media_type(image_path), 'data': data}},
            {'type': 'text', 'text': 'Analyze the residential lot at the center of this satellite tile.'}]}],
        output_format=SatelliteSignals,
    )
    usage = resp.usage
    usd = llm_cost(model, usage.input_tokens, usage.output_tokens)
    record('satellite_vision_llm', usd, door_id, model=model, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)
    out = {'model': model, 'prompt_version': PROMPT_VERSION, 'usd': round(usd, 6),
           'signals': resp.parsed_output.model_dump()}
    cache.write_text(json.dumps(out, indent=1))
    return out
