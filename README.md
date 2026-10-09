# Door Score — Ramsey, NJ

Given only a polygon, produce a **Door Score** for every single-family home inside it, with evidence
a field rep can act on, plus a map UI and an MCP server so an AI assistant can plan a knock route.

```
data/territory.geojson  ──▶  pipeline (Python)  ──▶  data/out/doors.{json,geojson}
                                  │                         │            │
          NJ parcels · permits · Census ACS · Street View   ▼            ▼
                 Claude vision · eval harness            web/ (React map)   mcp/ (MCP server)
```

## Repo layout

| Path | What |
|---|---|
| `pipeline/doorscore/` | Python pipeline: harvest → normalize → vision → score. Entry: `python -m doorscore.run` |
| `pipeline/doorscore/harvest/` | One module per source: `parcels.py` (NJ statewide parcel + MOD-IV tax, by polygon), `census.py` (ACS tract profile), `permits.py` (NJ DCA construction permits by block/lot, found by the discovery agent), `streetview.py` (imagery with free metadata pre-check) |
| `pipeline/doorscore/vision/` | Claude vision detector with structured output, confidence gates, per-image cache |
| `pipeline/doorscore/eval/` | Eval harness: stratified sampler, model-assisted draft labels, human labeler page, P/R/hallucination/cost runner |
| `pipeline/doorscore/discover.py` | Source-discovery agent (Claude + web search) → `data/out/sources.json` |
| `pipeline/doorscore/score.py` | The Door Score. Every signal names the ICP trait it supports |
| `pipeline/select_territory.py` | Only used because no polygon was supplied: picks a ~540-home cluster |
| `web/` | React + TypeScript + MapLibre map UI (Railway static site) |
| `mcp/` | TypeScript MCP server over Streamable HTTP: `get_door_score`, `explain_score`, `plan_route`, `list_top_doors`, `territory_stats` |
| `docs/door-score-rationale.md` | One-page ICP + score rationale |
| `data/eval/` | Labeled eval sample, images, results (committed) |

## Setup

```bash
# Python pipeline
python3 -m venv pipeline/.venv && pipeline/.venv/bin/pip install -r pipeline/requirements.txt
cp .env.example .env   # fill in keys; see below

# Web + MCP
(cd web && npm install)
(cd mcp && npm install)
```

### Environment variables (`.env` at repo root)

| Var | Needed for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | vision, eval, discovery | |
| `GOOGLE_MAPS_API_KEY` | Street View | Enable *Street View Static API*. ~$7 / 1k images; metadata calls are free |
| `CENSUS_API_KEY` | tract enrichment | Free: https://api.census.gov/data/key_signup.html |

The parcel stage, scoring, map and MCP server all run with **no keys**.

## Run end to end

```bash
cd pipeline && source .venv/bin/activate

python -m doorscore.run                       # parcels + census + score (seconds, free)
python -m doorscore.run --vision --limit 25   # add Street View + vision for 25 doors (proof of cost)
python -m doorscore.run --vision              # full territory
python -m doorscore.discover                  # source discovery agent → data/out/sources.json

# Eval harness
python -m doorscore.eval.sample --n 80        # stratified sample → data/eval/sample.jsonl + images
python -m doorscore.eval.draft_labels         # stronger model drafts labels (verified_by_human=false)
#   open data/eval/labeler.html (any static server) and verify every row; download labels.jsonl into data/eval/
python -m doorscore.eval.run_eval             # precision / recall / hallucination / cost per door
python -m doorscore.eval.run_eval --model claude-sonnet-5-5   # compare a model tier
```

Every stage is idempotent and cached under `data/cache/` (gitignored), keyed by polygon hash,
image hash, prompt version and model. Re-running costs nothing unless inputs changed.
`data/cache/cost_ledger.jsonl` records every paid call; `run_report.json` summarizes coverage and spend.

### Different territory

Replace `data/territory.geojson` with any GeoJSON polygon in New Jersey and re-run. Nothing is
keyed to Ramsey except `select_territory.py`, which only exists because no polygon was provided.

## Web map

```bash
cd web && npm run dev        # http://127.0.0.1:5173  (copies data/out → public/data first)
npm run build && npm start   # production: serve -s dist on $PORT
```
Railway: root directory `web/`, build `npm run build`, start `npm start` (`web/railway.json`).

## MCP server

```bash
cd mcp && npm run build && npm start   # POST /mcp on :3333, GET /health
npm run smoke                          # health + tools/list + a tools/call
```
Railway: Dockerfile at `mcp/Dockerfile` with repo root as build context (`mcp/railway.json`).
Example question an assistant can now answer: *"I've got 2 hours in Ramsey. Which 20 doors, in what order, and what do I say?"* → `plan_route(hours=2)`.

## Cost discipline (in code, not just claimed)

- Free Street View **metadata** call before every paid image; no pano → no spend.
- One 640×640 image per door, cached forever on disk.
- Vision runs on the cheapest tier first (`claude-haiku-4-5`); the eval harness is how we decide whether a stronger model earns its cost.
- Structured output + confidence threshold (0.6) means low-confidence detections never reach the score.
- Ledger-based `usd_per_door` in every run report.

## Data ethics

- Owner names are redacted in NJ data under Daniel's Law; we never request or store `OWNER_NAME`.
- The owner **mailing address** is consumed only to derive an `owner_occupied` flag and is then discarded.
- Census signals are tract-level aggregates. Tax-exempt status (e.g. disabled-veteran exemption) is never used as a signal.
- The vision prompt forbids identifying people or reading plates. Sources whose value is identity data are documented but not harvested (`sources.json`).
