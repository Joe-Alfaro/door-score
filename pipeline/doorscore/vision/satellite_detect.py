"""Extract ICP-relevant signals from one overhead satellite tile with a vision model.

Same honesty contract as the Street View detector: every detection carries a confidence and
the visible evidence behind it, and absence is reported as absence.

Cache keys: metadata key `(door_id, zoom, prompt version, model)` so results are reusable without
the tile on disk, with the legacy image-hash key as fallback. `sat-v1` is production; `sat-v2` is
the output-token diet (`SATELLITE_PROMPT_VERSION=sat-v2`).
"""
import os
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field
from ..config import CACHE
from .common import analyze_sync, image_hash, load_cached
from .detect import Detection

DEFAULT_MODEL = 'claude-sonnet-5-5'
OUT_DIR = CACHE / 'vision_satellite'
OUT_DIR.mkdir(exist_ok=True)
STAGE = 'satellite_vision_llm'
USER_TEXT = 'Analyze the residential lot at the center of this satellite tile.'

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

SYSTEM_V1 = """You analyze a single overhead satellite tile centered on one residential lot for a home-services company.
Report only what is clearly visible from above in THIS image, and only for the lot at the center of the tile;
neighboring lots at the edges do not count. If something is not visible, mark it absent with low confidence
and an empty evidence string. Never guess at what might be hidden under tree canopy or shadow.
Never identify people; if people are visible, ignore them entirely.
Confidence calibration: 0.9+ only when unmistakable; 0.6-0.8 when likely; below 0.5 when unsure.
A pool is a rectangular or kidney-shaped blue/turquoise water surface, or a clearly pool-shaped cover.
Solar panels are regular dark rectangular grids on a roof face; skylights and dark shingles do NOT count.
A trampoline is a round dark disc with a lighter rim; a shadow, fire pit, or round patio is NOT one.
Roof condition is 'not_visible' when canopy or resolution prevents a judgment."""

SYSTEM_V2 = SYSTEM_V1 + """
Output length rules, strictly: when present=false, evidence is exactly "" (never explain an absence).
When present=true, evidence is one clause of at most 12 words naming the visible object.
detail is at most 6 words or null. notes is one sentence of at most 15 words, or "" when there is
nothing a field rep needs to know."""

SYSTEM_V3_OUTLINE = SYSTEM_V1 + """
The property under review is outlined in yellow with a yellow dot at its center. Report ONLY what lies
inside the yellow outline. Pools, solar panels, play equipment or structures outside the outline belong
to neighbours and must be reported as absent for this property."""
SYSTEMS = {'sat-v1': SYSTEM_V1, 'sat-v2': SYSTEM_V2, 'sat-v3-outline': SYSTEM_V3_OUTLINE}
OUTLINE_MODE = PROMPT_VERSION_ENV = os.getenv('SATELLITE_PROMPT_VERSION', 'sat-v1').endswith('outline')
PROMPT_VERSION = os.getenv('SATELLITE_PROMPT_VERSION', 'sat-v1')
if PROMPT_VERSION not in SYSTEMS:
    raise RuntimeError(f'SATELLITE_PROMPT_VERSION={PROMPT_VERSION!r}; known: {sorted(SYSTEMS)}')
SYSTEM = SYSTEMS[PROMPT_VERSION]


def _cache_path(image_path: str, model: str) -> Path:
    """Legacy key: needs the tile bytes."""
    return OUT_DIR / f'{image_hash(image_path)}_{PROMPT_VERSION}_{model}.json'

def meta_cache_path(door_id: str, zoom: int, model: str, prompt_version: str = PROMPT_VERSION) -> Path:
    return OUT_DIR / f'{door_id}_z{zoom}_{prompt_version}_{model}.json'

def cache_paths(door_id: str | None, zoom: int | None, model: str, image_path: str | None) -> list[Path]:
    paths = []
    if door_id and zoom is not None:
        paths.append(meta_cache_path(door_id, zoom, model))
    if image_path and Path(image_path).exists():
        paths.append(_cache_path(image_path, model))
    return paths

def cached_result(door_id: str | None, zoom: int | None, model: str, image_path: str | None = None) -> dict | None:
    return load_cached(cache_paths(door_id, zoom, model, image_path))

def analyze_image(image_path: str, door_id: str | None = None, model: str = DEFAULT_MODEL,
                  client=None, zoom: int | None = None, expected_usd: float = 0.0) -> dict:
    paths = cache_paths(door_id, zoom, model, image_path)
    cached = load_cached(paths)
    if cached:
        return cached
    if not Path(image_path).exists():
        raise FileNotFoundError(f'{image_path}: no cached vision result and no tile to analyze')
    return analyze_sync(image_path=image_path, model=model, system=SYSTEM, user_text=USER_TEXT,
                        schema=SatelliteSignals, prompt_version=PROMPT_VERSION, stage=STAGE, door_id=door_id,
                        cache_paths=paths or [_cache_path(image_path, model)], client=client, expected_usd=expected_usd)
