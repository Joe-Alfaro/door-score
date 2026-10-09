# Console API image. Build context is the REPO ROOT (the image needs data/ as well as pipeline/):
#   docker build -f pipeline/Dockerfile -t door-score-api .
#   docker run --rm -p 8000:8000 door-score-api
# Layout mirrors the repo (/app/pipeline/doorscore + /app/data) so config.py's ROOT = parents[2] resolves.
# Image caches (data/cache/streetview, data/cache/satellite) are not shipped; JSON caches are, so the
# `pipeline` and `eval` stages run inside the container without paying for any LLM call.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY pipeline/requirements.txt pipeline/requirements.txt
RUN pip install -r pipeline/requirements.txt

COPY pipeline/doorscore pipeline/doorscore
COPY pipeline/tests pipeline/tests
COPY data/territory.geojson data/territory.geojson
COPY data/out data/out
COPY data/eval data/eval
COPY data/cache/acs_tracts.json data/cache/parcels_*.geojson data/cache/
COPY data/cache/vision data/cache/vision
COPY data/cache/vision_satellite data/cache/vision_satellite
COPY data/cache/streetview_meta data/cache/streetview_meta
COPY data/cache/permits data/cache/permits
COPY data/cache/census_tract data/cache/census_tract

# Stage subprocesses run with cwd=/app/pipeline, so `python -m doorscore.run` and `pytest tests` resolve.
WORKDIR /app/pipeline
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn doorscore.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
