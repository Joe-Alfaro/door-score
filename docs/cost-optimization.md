# Cost optimization

Where the API spend went, what each lever is worth, and what changed in the pipeline to bend the curve.
All figures come from `data/cache/cost_ledger.jsonl` (every paid call with model and token counts) and the
committed vision caches; regenerate the tables with `pipeline/.venv/bin/python -m doorscore.costs`.

Prices used: Haiku 4.5 $1/$5, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per MTok (input/output); Message Batches 50% off
every token; cache reads 0.1x input (0.05x on Opus 5.5), cache writes 1.25x. Street View image $0.007, satellite
tile $0.002.

## 1. Spend analysis

Ledger: 2,970 paid calls, **$18.71** of the $50 budget (cap for the pipeline: `MAX_SPEND_USD`, default $45).

| Stage | Model | Calls | USD | Share |
|---|---|---:|---:|---:|
| Street-level vision (production) | Sonnet 5.5 | 569 | 4.81 | 26% |
| Satellite vision (production) | Sonnet 5.5 | 569 | 4.32 | 23% |
| Street View images | - | 569 | 3.98 | 21% |
| Street-level vision (superseded full pass + eval) | Haiku 4.5 | 594 | 1.87 | 10% |
| Street-level vision (eval label drafts) | Opus 5.5 | 98 | 1.73 | 9% |
| Satellite tiles | - | 569 | 1.14 | 6% |
| Source discovery agent (2 runs) | Sonnet 5.5 | 2 | 0.86 | 5% |

Production (imagery + Sonnet vision on both views) is $14.25 = **$0.0251/door**; eval + discovery is $4.46.

Street View frames are no longer stored or served from the project: each photo shown in the map, console or via the MCP `street_view.image_url` is fetched live through `/api/streetview/{door_id}.jpg` and billed as a `streetview_view` ledger row ($0.007). The ledger total above predates that stage (0 such rows).

### Per-call token profile

| Stage | Model | Calls | Mean in | Mean out | p90 out | Input $ | Output $ | Output share | $/call |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| street vision | Haiku 4.5 | 594 | 1,798 | 270 | 287 | 1.07 | 0.80 | 43% | 0.00315 |
| street vision | Opus 5.5 | 98 | 2,128 | 458 | 644 | 0.83 | 0.90 | 52% | 0.01766 |
| street vision | Sonnet 5.5 | 569 | 2,128 | 421 | 474 | 2.42 | 2.39 | 50% | 0.00846 |
| satellite vision | Sonnet 5.5 | 569 | 2,064 | 346 | 610 | 2.35 | 1.97 | 46% | 0.00759 |

Reading the profile:

- Input is constant per call (every image is 640x640, about 546 image tokens), so roughly **1,550 of the ~2,100
  input tokens are the system prompt plus the structured-output schema**, byte-identical on every call. That is the
  prompt-caching candidate.
- **Output is half of what each call costs.** The output is JSON whose free text is dominated by `notes`
  (181 chars mean, street; 213 satellite), `usability_note` (144 chars) and `evidence` strings. Across the 569
  street results, 567 of 3,378 *absent* detections still carry evidence text (the prompt asks for an empty string).
- Haiku's per-call cost is 37% of Sonnet's, not the 50% the price list suggests, because it also writes less.

### Levers, ranked by estimated saving

(a) = full re-run of this territory, (b) = a new 569-home territory. Baseline for (b) is $14.25
(imagery $5.12 + vision $9.13).

| # | Lever | (a) re-run | (b) new territory | Quality risk | Status |
|---|---|---:|---:|---|---|
| 1 | Metadata-keyed vision cache (results reusable without the gitignored images) | **$14.25 -> $0** from a fresh clone; previously a clone without `data/cache/streetview` would re-buy 569 images ($3.98) and re-run vision ($9.13) because the key was the image hash | $0 | none | **shipped**, verified |
| 2 | Message Batches for both vision stages (50% off) | $0 (cached) | **-$4.57** | none; wall-clock only (usually < 1 h, max 24 h) | **shipped**, opt-in `VISION_BATCH=1`, not yet exercised against the API |
| 3 | Prompt caching of system + schema prefix (0.1x on ~1,550 tokens) | $0 | **up to -$3.20** sync, -$1.60 on top of batch (cache hits inside a batch are best-effort) | none | **shipped** (`cache_control` on the system block); *unverified*: whether the structured-output schema sits in the cached prefix, and Sonnet 5.5's 512-token minimum, need a 2-call probe (~$0.02). Haiku 4.5 cannot benefit (4,096-token minimum). |
| 4 | Output-token diet (`v3` / `sat-v2` prompts: empty evidence when absent, 12-word evidence, 15-word notes, 8-word usability note) | $0 | **-$0.9 to -$1.2** sync (28% of output tokens, ~119 street / ~97 satellite per call), about half that on top of batch | low: field names and types unchanged; free text shorter | **shipped**, default stays `v2`; switch with `VISION_PROMPT_VERSION=v3` / `SATELLITE_PROMPT_VERSION=sat-v2`; **not run** |
| 5 | Haiku for satellite only | $0 | -$2.5 sync / -$1.25 batch | unknown: no human eval exists for satellite | needs a $0.3 eval first (section 6) |
| 6 | Haiku-screen / Sonnet-confirm cascade, street-level | $0 | ~-$1.8 | fails the precision bar (section 6) | rejected |
| 7 | Hard spend cap (`MAX_SPEND_USD`) | protects the remaining $31 | same | none | **shipped** |

Combined for a new territory with levers 2 + 4 shipped and 3 verified: vision drops from $9.13 to roughly
**$2.4 to $3.0**, total territory **$7.5 to $8.1** vs $14.25. Imagery ($5.12) is the floor: Street View and the
satellite tile are priced per image regardless of size, and downscaling images for the model would save only
~$0.0004/call (5%) while shrinking the signs and trucks we are looking for.

## 2. Metadata-keyed vision cache

Street-level results are now keyed by `(door_id, pano_id, prompt_version, model)` using the free Street View
metadata (`data/cache/streetview_meta/<door_id>.json`), as `data/cache/vision/<door_id>+<pano_id>_<version>_<model>.json`.
Satellite results are keyed by `(door_id, zoom, prompt_version, model)` as
`data/cache/vision_satellite/<door_id>_z<zoom>_<version>_<model>.json`. The old `sha1(image)` keys remain as a fallback
and are still what the eval harness and the API console resolve (`detect._cache_path` is unchanged).

Both stages now resolve the cache **before** fetching imagery, so a door with a cached result never touches the
image API or the model; only uncached doors fetch an image (paid) and are analyzed. A paid result is written to
the cache before its ledger row, so a crash or a budget stop between the two cannot lose it.

Migration: `python -m doorscore.vision.migrate_cache` (idempotent, no API call) duplicated every existing entry:
1,261 street-level (Haiku v1/v2, Sonnet v2, Opus v2) and 569 satellite. Verification (API keys set to invalid
strings so any attempted paid call would have failed):

| Run | Wall-clock | Ledger lines before / after | `doors.json` vs pre-change baseline |
|---|---:|---|---|
| `run --vision`, images present | 1.6 s | 2970 / 2970 | identical |
| `run --vision`, `streetview/` and `satellite/` directories renamed away | 0.5 s | 2970 / 2970 | identical (569/569 doors with vision and satellite) |
| `eval.run_eval` for Haiku and Sonnet (hash-key fallback path) | - | 2970 / 2970 | results regenerated |

## 3. Hard budget cap

`doorscore/costs.py`:

- `MAX_SPEND_USD` (env, default 45). `record()` appends the row and then raises `BudgetExceeded` if the ledger total
  passed the cap. The row is written first because the call has already been paid for; the exception exists to stop
  the next one.
- `ensure_budget(expected_usd)` raises *before* a call that would cross the cap; both detectors call it with the
  measured per-call rate, and the batch path calls it with the whole batch estimate before submitting anything.
- Stage behaviour (unit-tested without network): on `BudgetExceeded` the thread pool stops issuing new calls, results
  already obtained (including the call that crossed the cap, which was cached) stay attached, and the stage prints
  `[vision] STOPPED: spend cap reached: ledger total $X > MAX_SPEND_USD $Y. N doors left without vision; raise
  MAX_SPEND_USD to continue.` The run then scores and writes outputs normally.
- The total is loaded once per process and kept current in memory; two processes recording concurrently could each
  overshoot by one call.
- `estimate_vision_cost(doors, model, satellite=True, batch=False)` returns uncached calls and images to fetch per
  stage, the measured `usd_per_call` (ledger mean, or the measured token profile at list price for a model with no
  history), totals, `spent_usd`, `max_spend_usd` and `fits_budget`. It reads the metadata cache only and never calls
  an API. For the cached territory it returns $0; for a fresh 569-door territory: Sonnet $14.25 sync / $9.69 batch,
  Haiku $9.07 / $7.10.

## 4. Message Batches (opt-in)

`VISION_BATCH=1 python -m doorscore.run --vision`, or `run_vision(doors, batch=True)` / `run_satellite(doors, batch=True)`.
Per stage, every uncached image is fetched, then submitted as **one batch** (`doorscore/vision/batch.py`), polled every
30 s, and each result is validated with the same Pydantic model (`StreetViewSignals` / `SatelliteSignals`) and
written to the same cache files with `batch: true` and the batch id; the ledger row carries `batch: true` and the
50% price. Structured output is preserved by sending `output_config.format = {type: 'json_schema', schema: ...}`
with exactly the schema `messages.parse()` derives (the unit test asserts equality with the SDK's transform).
Expected saving: 50% of vision spend, $4.57 on a new territory. Not exercised against the API yet; the request
builder, result handling, cost recording and cap behaviour are covered by `tests/test_vision_batch.py` and
`tests/test_vision_stage.py` with a stub client.

## 5. Output-token diet (`v3`)

`v3` (street) and `sat-v2` (satellite) append an output-length contract to the system prompt; the schema and every
field name are unchanged, so `score.py`, `score_satellite.py`, the web evidence card and the MCP talking points all
keep working. Measured on the cached v2 outputs, the removable text is ~330 chars/call street (28% of output
tokens) and ~227 chars/call satellite (28%), worth about $0.0012 and $0.0010 per call at Sonnet prices:
$0.9 to $1.2 per 569-door territory synchronous, roughly half on top of batch. Enable with
`VISION_PROMPT_VERSION=v3` and/or `SATELLITE_PROMPT_VERSION=sat-v2`; each version has its own cache namespace, so
switching on an already-cached territory would re-run (and re-pay) vision. Recommended first use: the next new
territory, in batch mode, then rerun `make eval` on the 98 labeled images (~$0.50 sync, $0.25 batch) to confirm
precision did not move before making it the default.

## 6. Model tier recommendation

Eval: 98 human-verified Street View images, confidence gate 0.5 (`data/eval/results_*.json`).

| Signal | Positives | Haiku P / R | Sonnet P / R | Cascade Haiku-screen, Sonnet-confirm P / R |
|---|---:|---|---|---|
| provider_truck | 1 | 0.50 / 1.00 | 1.00 / 1.00 | 0 / 1 (gate 0.6) |
| yard_sign | 6 | 0.17 / 0.67 | 0.67 / 0.67 | 0.50 / 0.33 |
| renovation_activity | 5 | 1.00 / 0.40 | 1.00 / 0.80 | 1.00 / 0.40 |
| moving_indicators | 1 | 1.00 / 1.00 | 1.00 / 1.00 | - |

**(a) Street-level: stay on Sonnet 5.5, and take the cost out with batch (+ v3, + verified caching) instead of a
cheaper model.** Haiku fails the precision bar on the two signals that carry score weight (truck 0.50 vs 1.00,
yard sign 0.17 vs 0.67) and hallucinates on 21-32% of negatives. The cascade does not rescue it: the screen misses
60% of renovations and half the yard signs, so confirmed precision/recall land at 0.50/0.33 (yard sign) and
0/1 (truck), both below production. Sonnet in batch mode costs $0.0042/call, which is already *cheaper than
synchronous Haiku* ($0.0032 + the Sonnet confirmations) with no quality trade. Haiku-batch ($0.0016) would save a
further $1.5 per territory, which does not buy back the precision loss.

**(b) Satellite: Haiku is plausible but unproven; do not switch without the eval.** Pools are high-contrast,
geometrically simple and 59/569 doors have one, so this is the one place Haiku's pattern of asserting things that
are not there might not bite. But the same tile also drives `detached_structure` (159 positives), `play_equipment`
(23) and `solar_panels` (8), and Haiku's street-level failure mode was exactly over-asserting small ambiguous
objects. Required eval before any switch:

- Label set: ~100 tiles, stratified like the street eval: all 8 solar and all 23 play-equipment positives, 30 of the
  59 pool positives, 40 random tiles. Draft labels are free (Sonnet's results are cached); a human verifies each row
  in the existing labeler. Sonnet's predictions on those tiles are already cached, so its side of the comparison
  costs $0.
- Haiku predictions on the 100 tiles: 100 x ~$0.0032 = **$0.32 synchronous, $0.16 in batch**.
- Decision rule: adopt Haiku for satellite only if, on the same labeled set, its precision for `swimming_pool` and
  `solar_panels` is >= Sonnet's and its hallucination rate on negatives is <= 2% for every scored signal. If pools
  pass but structures do not, a per-signal split (Haiku pool-only pass, Sonnet for the rest) costs more than
  Sonnet-batch alone and is not worth it.
- Payoff if adopted: -$2.5 per territory synchronous, -$1.25 on top of batch.

## What changed (files)

- `pipeline/doorscore/costs.py`: `BudgetExceeded`, `MAX_SPEND_USD`, `ensure_budget`, `total_spend`, cache-aware and
  batch-aware `llm_cost`, `per_call_rate`, `estimate_vision_cost`, `analyze_ledger`, `python -m doorscore.costs`.
- `pipeline/doorscore/vision/common.py` (new): shared request builder (system block with `cache_control`), cache
  load/store, `analyze_sync` (cache written before ledger row).
- `pipeline/doorscore/vision/detect.py`, `satellite_detect.py`: metadata cache keys with hash fallback,
  `cached_result`, `cache_paths`, prompt versions `v3` / `sat-v2` behind env vars (defaults unchanged).
- `pipeline/doorscore/vision/stage.py`, `satellite_stage.py`: cache before imagery, budget stop, batch path.
- `pipeline/doorscore/vision/batch.py` (new): Message Batches submit/poll/collect at 50%.
- `pipeline/doorscore/vision/migrate_cache.py` (new): the key migration; already run.
- `pipeline/doorscore/harvest/streetview.py`, `satellite.py`: `image_info()` helpers (no download).
- `pipeline/tests/test_costs.py`, `test_vision_batch.py`, `test_vision_stage.py` (new).
- `data/cache/vision/*+*.json`, `data/cache/vision_satellite/*_z20_*.json`: migrated cache entries (1,830 files).
