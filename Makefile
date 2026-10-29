# One command runs the whole thing. Every stage is cached, so re-runs are cheap and idempotent.
PY := pipeline/.venv/bin/python
export PYTHONPATH := pipeline

.PHONY: all setup pipeline vision discover eval sync deploy clean-cache api api-deploy

all: pipeline                 ## score AREA=path/to/area.geojson locally (the map's "Draw an area" does this on the API)

setup:                        ## create venv, install python + node deps
	python3 -m venv pipeline/.venv && pipeline/.venv/bin/pip install -q -r pipeline/requirements.txt
	cd web && npm install --silent
	cd mcp && npm install --silent

AREA ?= data/territory.geojson

pipeline:                     ## score AREA (a GeoJSON polygon you supply; none ships with the repo) using cached vision only
	$(PY) -m doorscore.run --territory $(AREA) --vision --vision-cache-only

vision:                       ## fetch imagery + run vision for every door in AREA (paid; ~$0.025/door)
	$(PY) -m doorscore.run --territory $(AREA) --vision

discover:                     ## source-discovery agent → data/out/sources.json
	$(PY) -m doorscore.discover

eval:                         ## eval harness on human-verified labels (needs data/eval/labels.jsonl)
	$(PY) -m doorscore.eval.run_eval
	$(PY) -m doorscore.eval.run_eval --model claude-sonnet-5-5
	$(PY) -m doorscore.eval.report

sync:                         ## copy the MapLibre worker into web/ (no door data is bundled)
	cd web && npm run sync-data --silent

deploy:                       ## push both services to Railway (requires `railway login` + linked project)
	railway up web --path-as-root --service web -d
	railway up mcp --path-as-root --service mcp -d

api:                          ## console API on :8000 with reload (uvicorn)
	cd pipeline && .venv/bin/uvicorn doorscore.api:app --port 8000 --reload

api-deploy:                   ## push the console API to Railway (context = repo root; see README "Console API")
	railway up . --service api -d

clean-images:                 ## drop image files only (re-fetchable for ~$5; vision JSON caches are kept and committed)
	rm -rf data/cache/streetview data/cache/satellite

clean-cache-DANGEROUS:        ## drop ALL caches including vision JSON: the next --vision run re-bills the territory (~$14)
	rm -rf data/cache/vision data/cache/vision_satellite data/cache/streetview data/cache/satellite data/cache/permits data/cache/census_tract data/cache/acs_tracts.json

help:
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/ —/'
