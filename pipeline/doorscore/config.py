from pathlib import Path
import os
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env')

DATA = ROOT / 'data'
CACHE = DATA / 'cache'
OUT = DATA / 'out'
TERRITORY = DATA / 'territory.geojson'
for d in (CACHE, OUT):
    d.mkdir(parents=True, exist_ok=True)

ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
GOOGLE_MAPS_API_KEY = os.getenv('GOOGLE_MAPS_API_KEY')
CENSUS_API_KEY = os.getenv('CENSUS_API_KEY')

# Scoring is relative to "today" so tenure / recency are reproducible across runs.
AS_OF_YEAR = 2026
AS_OF_MONTH = 10
