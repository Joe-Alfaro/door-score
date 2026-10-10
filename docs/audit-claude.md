# Independent audit against the PRD

Audit date: 2026-10-10. Auditor: an adversarial reviewer with no prior knowledge of the project.
Method: every requirement in `docs/PRD.md` was numbered, then checked against code, committed data,
and the live deployments (GET only). Nothing in `README.md` or `docs/*.md` was taken on trust.

What was run locally (read-only otherwise):

- `pipeline/.venv/bin/python -m pytest pipeline/tests -q` → **88 passed in 1.15 s**.
- From `pipeline/`: `python -m doorscore.run --vision` with `ANTHROPIC_API_KEY` and
  `GOOGLE_MAPS_API_KEY` overridden to invalid strings (so any attempted paid call would have failed
  loudly). Output: `[vision] 569 doors served from cache, 0 need imagery + model`,
  `[satellite] 569 doors served from cache, 0 need a tile + model`, finished in 1.2 s.
  **Cost ledger: 2970 lines before, 2970 lines after.** The regenerated `data/out/doors.json` has
  identical scores, ranks, percentiles and per-signal points to the committed one; the only fields
  that changed are the local `vision.image.path` / `satellite.image.path` strings.
- Live probes: map `/` and `/data/doors.geojson` (200, 569 features), `/console` (200),
  `/img/streetview/0201_101_32.jpg` (200, image/jpeg), MapLibre worker (200); console API
  `/api/health`, `/api/status`, `/api/stages`, `/api/sources`, `/api/eval`, `/api/eval/sample`,
  `/api/doors`, `/api/tags`, `/api/ledger`, `/api/mcp/tools`, `/docs` (all 200); MCP `/health`
  (`{"ok":true,"doors":569}`), `tools/list` (6 tools), `tools/call` for `get_door_score`,
  `explain_score`, `plan_route {hours: 2}`, `plan_route {hours: 2, start_point, min_score: 55}`,
  and an unknown address (all returned well-formed JSON on the SSE `data:` line).

Status key: **Met** / **Partial** / **Not met** / **Cannot verify**. Line numbers refer to the
checkout at `/Users/joealfaro/Documents/door-score`.

---

## 1. Requirements traceability matrix

### A. The challenge and impact metrics

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 1 | A Door Score for every home in the polygon, with evidence a rep could act on tomorrow | Met | `data/out/run_report.json`: 637 parcels, 569 single-family doors, every door has `door_score`, `signals[]` (17 signals, each with `evidence`, `source`, `icp_trait`), `tags[]`. `pipeline/doorscore/score.py:88-132`. Live `/data/doors.geojson` returns the same 569. | Score range in data is 11-72, mean 33.5; 94% of doors sit between 20 and 50 (the docs say 93%). The map colours by territory percentile to compensate (`web/src/lib/score.ts:15-23`). |
| 2 | Vision: precision / recall on the top signal vs labeled samples | Partial | `pipeline/doorscore/eval/run_eval.py:35-47`; `data/eval/results_claude-sonnet-5-5.json`: `provider_truck` P 1.00 / R 1.00 with **tp=1, fp=0, fn=0**. `data/eval/labels.jsonl`: 98 rows, all `verified_by_human: true`. | The declared top signal has exactly one positive in the labeled set. The harness is sound; the number is not evidence of anything. `docs/test-results.md` admits this. The signal with real support is `yard_sign` (6 positives, P 0.67) and `renovation_activity` (5, P 1.00 / R 0.80). |
| 3 | Vision: hallucination rate | Met | `run_eval.py:44-45` (`fp / (fp + tn)` per signal) and `:70-73` (usability false-positive rate). Haiku: yard_sign 20.7%, professional_landscaping 31.9%; Sonnet: yard_sign 2.2%, others 0%. | The usability false-positive rate (model says usable, human says not) is **0.30 for Sonnet (3/10) and 0.50 for Haiku** and is computed but never reported in any doc. |
| 4 | Vision: cost per door within a $50 budget | Met | `data/cache/cost_ledger.jsonl`: 2,970 rows, $18.71 total (recomputed). Production (Street View $3.98 + tiles $1.14 + Sonnet street $4.81 + Sonnet satellite $4.32) = $14.25 / 569 = **$0.0251/door**. `pipeline/doorscore/costs.py:62-75` records every paid call; `:24` hard cap `MAX_SPEND_USD=45`. | README line 183 says "about a cent per door all-in", `docs/demo-script.md:53` says "under a cent per door, all in", `Makefile:17` says "~$0.011/door". All three are wrong; the measured figure in `run_report.json` is 2.5 cents. |
| 5 | Data engineering: territory coverage (% of ~540 homes with data) | Met | `run_report.json`: address 100%, year built 100%, assessed value 100%, owner-occupancy 100%, deed date 82.8%, building code 96.7%; Street View 569/569 fetched, 526 usable (92.4%); satellite 543 usable (95.4%); Census 568/569; permits 273 doors with any permit in 10 yrs (48%). | Coverage is genuinely complete for the parcel spine. |
| 6 | Data engineering: entity resolution / address match rate | Partial | `pipeline/doorscore/normalize.py:21-51` canonicalises addresses and towns; 56 unit cases in `pipeline/tests/test_normalize.py`. But the only use in the pipeline is `normalize.py:137-146`: comparing the property address with the owner mailing address to derive `owner_occupied`. Every cross-source join is on municipality code + block + lot (`harvest/permits.py:66-79`, `harvest/census.py` by lat/lng). Fuzzy address matching exists only in the MCP server (`mcp/src/address.ts:116-150`). | No address match rate is measured or reported anywhere. "Entity resolution across messy address formats" is a stated evaluation criterion and the pipeline never performs an address-keyed join. |
| 7 | Door Score predictive accuracy vs the hidden ground-truth set | Cannot verify | No outcomes exist in the repo. `docs/door-score-rationale.md:60-73` describes how it would be validated. | Weights are hand-set (`score.py`), not fitted. A grader will ask why 25 for new mover and 3 for yard sign. |
| 8 | Shipped: deployed, working map UI and MCP server (binary) | Met | Live: `https://web-production-39b2a.up.railway.app/` 200 html; `/data/doors.geojson` 200, 569 features; `https://mcp-production-1645.up.railway.app/health` → `{"ok":true,"doors":569}`; `tools/call plan_route {hours:2}` → 15 stops, 116.2 min. Console `/console` 200 and its lazy chunk `ConsoleApp-BBvCuZFC.js` contains the live API host. | Map rendering was verified by asset availability and data, not in a browser. |

### B. Functional requirement 1: agentic data collection

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 9 | Build agents/workflows that *discover* public data for the territory | Met | `pipeline/doorscore/discover.py`: Claude + web search, strict `register_source` tool with required `tos_ok`, `tos_note`, `pii_risk`, `icp_use` (`:17-32`), reachability probe (`:43-50`). `data/out/sources.json`: 20 sources, 14 `tos_ok`, 16 reachable, 2 runs, $0.86. Live `/api/sources` serves it. | The agent found the permit dataset that is now wired (`harvest/permits.py:1-5` credits it). |
| 10 | Harvest and normalize those sources without hand-building ETL for named sources | Partial | Harvesters are hand-written per source: `harvest/parcels.py`, `permits.py`, `census.py`, `streetview.py`, `satellite.py`. `run.py:40-60` calls them in a fixed order. `sources.json` is never read by the pipeline (`grep -rn sources.json pipeline/doorscore` → only `discover.py` and `api.py`). | The PRD does not name sources, so hand-building ETL for sources *you* found is defensible, but the discover → harvest handoff is a human step. Of 14 ToS-cleared sources, 3 are harvested (plus Google imagery, which the agent did not register). |
| 11 | Source discovery is evaluated | Met | As 9. `docs/technical-decisions.md:13`. | |
| 12 | Entity resolution across messy address formats is evaluated | Partial | As 6. | |
| 13 | "How much of your pipeline runs without you" | Partial | `Makefile:14-15` `make all` = parcels + permits + census + cached vision → score → sync. Every stage cached and idempotent (verified: 1.2 s, $0). Console API runs stages as subprocesses with live logs (`api.py:268-291`). But: `Makefile:15` only passes `--vision` if `data/cache/streetview/*.jpg` exists, and those JPEGs are gitignored (`.gitignore`) and absent in this checkout (`data/cache/streetview/` contains only a `streetview.hidden/` directory). **`make -n pipeline` here prints `python -m doorscore.run` with no `--vision`**, so `make all` from a fresh clone rescores 569 doors without any imagery signals and then `sync` overwrites `mcp/data/doors.json` and `web/public/data/doors.geojson` with those vision-less scores. Eval labeling is a human step by design. | The metadata-keyed cache (`docs/cost-optimization.md` section 2) made the JPEG gate obsolete; the Makefile was not updated. |

### C. Functional requirement 2: vision pipeline with evals

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 14 | Extract ICP-relevant signals from imagery (trucks, yard signs, lawn/roof/exterior, pools, solar, ...) | Met | Street-level schema `vision/detect.py:30-49` (truck, yard sign, moving indicators, renovation, landscaping, solar, lawn/exterior/roof condition); overhead schema `vision/satellite_detect.py:27-36` (pool, solar, play equipment, detached structure, roof, tree cover). Scored in `score.py:168-234` and `score_satellite.py`. Data: 58 pools, 7 solar, 1 truck, 2 moving, 38 "visible wear" tags. | Listing photos are not used (defensible: ToS). Only the latest Street View pano is used. |
| 15 | Non-negotiable: ship an eval harness | Met | `pipeline/doorscore/eval/{sample,draft_labels,run_eval,report,schema}.py` + `labeler.html`. `make eval` runs both models and rewrites `docs/test-results.md` between markers. Console `eval` stage runs it. | Runnable; verified `/api/eval/sample` serves cached predictions for both models with no null predictions. |
| 16 | Labeled samples | Met | `data/eval/labels.jsonl`: 98 rows, 98 `verified_by_human: true`, images committed under `data/eval/images/` (98 files). Labeler values show 91 `draft:claude-opus-5-5+human`, 6 `+human`. | `docs/test-results.md` says "14 fields changed across 98 rows" after human review. Comparing `sample.jsonl` (drafts) to `labels.jsonl` gives **60 value-to-value changes** (lawn 21, exterior 14, roof 12, yard sign 5, landscaping 4, usable 4, renovation 1). The "14" claim could not be reproduced from the committed files. |
| 17 | Precision / recall on at least the top signal | Partial | As 2. | n=1 for the top signal. |
| 18 | Hallucination checks | Met | As 3. Threshold sweep `run_eval.py:57-69`. | |
| 19 | Cost per door | Met | As 4; `run_eval.py:89-92` prints production $/door from the ledger. | |

### D. Functional requirement 3: the Door Score

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 20 | Fuse everything into a score you define and defend; one-page rationale | Met | `docs/door-score-rationale.md` (fits one page); `score.py` additive points rescaled over available signals (`:114-118`), percentile for display (`:131`). | Rescaling means a door with no usable imagery is scored over a smaller denominator; the docs call this "never penalized". It is also "never credited" with any imagery negative, which a grader may call out as inflating imagery-less doors. |
| 21 | Who is the ideal door; translate "dual-income, hires-out" into public-data detectors | Met | Rationale table rows map each trait to a source. Dual-income = ACS tract share of two-parent families with both parents working (`harvest/census.py:57-58`) + 2-story / 2-car proxy (`score.py:77-86`). | The dual-income detector is tract-level (3 tracts for the whole territory) so it barely separates doors; weight 6 of ~140 max. Honest, but thin. |
| 22 | Every signal must trace to the ICP definition | Met | `score.py:10-17` `Signal.icp_trait` is mandatory; all 17 signals in `doors.json` carry one; MCP `explain_score` returns it per signal (live call verified). | |
| 23 | How would you validate against real outcomes | Met | `docs/door-score-rationale.md:60-73`: hold-out AUC/lift, per-signal ablation, logistic refit, new-mover window calibration, route-level A/B, drift. | Reasonable. |

### E. Functional requirement 4: ship it

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 24 | Deployed map UI, every door scored, click for evidence (truck/imagery date, deed date/new mover, absentee owner) | Met | `web/src/components/EvidenceCard.tsx:88-93` renders every signal with evidence; `score.py:162-166` stamps the Street View capture date into the source string (e.g. "Street View 2025-07"); tags include `new mover`, `absentee owner`, `provider on site`. Deep link `/?door=<id>` (`web/src/App.tsx:62-70`). Live geojson confirms 569 doors with these fields; worker and CSS assets 200. | Not clicked in a browser by this audit. The `vision.image.path` field in the public geojson contains the author's local absolute path (`/Users/joealfaro/.ao/...`) for all 569 doors. Harmless but sloppy. |
| 25 | MCP server with `get_door_score`, `explain_score`, `plan_route(hours, start_point)`; answers "2 hours, which 20 doors, what order, what to say" | Met | `mcp/src/tools.ts:98-245`; `route.ts:50-97` greedy score-per-minute + 2-opt; `talking-points.ts` per-stop lines. Live `plan_route {hours: 2}` → 15 stops, 116.2 min total, 26.2 walking, each with `talking_point` and `explain_url`. Also `list_top_doors`, `territory_stats`, `get_signal_summary`. Stateless Streamable HTTP (`server.ts:38-54`). | With defaults (`min_score` 50, `max_doors` 20) only 15 doors qualify for two hours because few doors score ≥ 50; the example asks for 20. Talking points are templates, not LLM (`technical-decisions.md:42`). `docs/demo-script.md:370` says `explain_score` returns "a deep link into the map"; it does not (only `plan_route` stops carry `explain_url`). |
| 26 | Bonus: homeowner layers (absentee, tenure, household inference, permit history) | Met | `normalize.py:142-146` absentee; `score.py:138` long-tenure tag; `score.py:77-86` household proxy; `harvest/permits.py` + `score.py:238-253`. | |
| 27 | Bonus: time-series imagery | Not met | `docs/technical-decisions.md:19` explicitly out of scope. | Honest. |
| 28 | Bonus: neighborhood effects | Met | `pipeline/doorscore/neighborhood.py` (grid-bucketed 150 m / 200 m neighbour counts) + `score_neighborhood.py` (6 pts by percentile). 113 doors tagged `active block`. | Percentile-based, so it always awards points to the top 20% of streets even in a dead-quiet territory. |
| 29 | Daniel's Law: owner names redacted; handling of identity data is evaluated | Met | `harvest/parcels.py:15-20` explicit field list excludes `OWNER_NAME`; `grep OWNER_NAME data/cache/parcels_*.geojson` → 0 hits; mailing address fields present in the raw cache (637) but absent from `doors.json` (only derived `owner_occupied`, `owner_mailing_out_of_town`). Vision prompts forbid identifying people (`detect.py:54`, `satellite_detect.py:42`). Discovery prompt refuses identity sources (`discover.py:38-40`); SR1A grantor/grantee caveat in `sources.json`. | Two soft spots: (a) `tax_exempt_residence` is published per door in the public geojson for 4 class-15F parcels while the docs say exemption status is "never used"; it is not scored, but it is exposed. (b) `annual_tax`, `sale_price`, `net_value`, deed date are all public records, but they are now re-published per address on an open endpoint with a photo of the house. |

### F. Performance benchmarks (the four 25% rubric lines)

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 30 | Data engineering: coverage, entity resolution, pipeline autonomy | Partial | Coverage strong (5). Entity resolution weak (6). Autonomy good at run time, with the Makefile gating defect (13). | |
| 31 | AI engineering: vision quality by evals, cost discipline, agent design | Partial | Evals are real and drove decisions (model tier, dropped landscaping signal, gate 0.5). Cost discipline is in code (39). But the top signal's eval is n=1, and the satellite signals (pool 6, solar 3, play 4, roof 4 = 17 of the score) have **no human eval at all** (`docs/test-results.md` "Overhead imagery (no human eval yet)"). Agent design: one discovery agent, one-shot. | |
| 32 | Judgment: ICP reasoning, score defensibility, ethics | Met | Rationale, traceable signals, explicit exclusions, dropped signal after eval. | See section 4 for what a grader will probe. |
| 33 | Shipped quality: deployed, working MCP + map, demo | Met | Three live services verified. Demo video exists locally (`demo-video/door-score-demo.mp4`, 23 MB) but is **untracked and unlinked** (see 52). | |

### G. Code quality expectations

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 34 | Working > polished | Met | Everything deployed works. 88 unit tests. | |
| 35 | Reproducible pipeline: README setup, env vars documented, no hardcoded secrets, re-run end to end | Partial | README "Setup", "Environment variables", `.env.example`; `git log --all -- .env` is empty; `git grep` for Google/Anthropic key patterns finds nothing; `config.py:20-21` pins the as-of date so tenure math is stable. Cached re-run verified ($0, identical scores). But: `make all`/`make pipeline` and the README's `python -m doorscore.run` both drop vision on a fresh clone (13); `pipeline/select_territory.py` reads `data/raw/ramsey_parcels_all.geojson`, which is gitignored and absent, so the polygon choice is not reproducible (the polygon itself is committed). | The README claim "A fresh clone ... rescored 569 doors with vision in 0.5 s and $0" (`technical-decisions.md:35`) is true only if you type `--vision` yourself. |
| 36 | Pipeline autonomy: orchestrated workflows, not brittle hand-run scripts | Partial | `Makefile`, console runner with cost gate and run history (`api.py`). Label verification, discovery-to-harvester wiring and deploy (`make deploy`) are manual. | |
| 37 | Evals are code, runnable | Met | As 15. | |
| 38 | Defensible in Q&A | Cannot verify | Code is compact and commented with intent. The numeric inconsistencies across docs (section 3) are the main Q&A liability. | |
| 39 | Cost discipline visible in code: caching, batching, model-tier choices | Met | Free metadata pre-check before any paid image (`harvest/streetview.py:32-48`); cache written before the ledger row (`vision/common.py:53-69`); metadata-keyed cache so JSON results survive without images (`detect.py:80-95`); hard cap `costs.py:55-75` with unit tests; `cache_control` on the system block (`common.py:42`); Message Batches path at 50% (`vision/batch.py`); model-tier decision recorded in `detect.py:22`; `python -m doorscore.costs` spend analysis. | Batches "not yet exercised against the API" and prompt caching "unverified" per `docs/cost-optimization.md:54-55`; both are stub-tested only. |

### H. Technology and other requirements

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 40 | Languages: Python and/or TypeScript recommended | Met | Python pipeline, TypeScript map/console/MCP. | |
| 41 | Any LLM API; must build an MCP server; must ship a custom eval harness | Met | Anthropic SDK (`requirements.txt`), `@modelcontextprotocol/sdk` (`mcp/package.json`), eval harness (15). | |
| 42 | Git required; map framework; geospatial tooling | Met | 39 commits (2026-10-08 → 10-10); MapLibre (`web/src/components/MapView.tsx`); Shapely (`territory.py`, `normalize.py`). | |
| 43 | Map UI and MCP server deployed and publicly demoable | Met | As 8. Railway, three services. | |
| 44 | Public data sources only; scraping outside ToS is an automatic judgment failure | Partial | All harvested sources are government open data or Google paid APIs; the discovery agent records ToS per source and refuses listing sites. However: 569 Street View JPEGs are committed to git (`git ls-files web/public/img/streetview` → 569) and re-served from the project's own domain (`/img/streetview/<id>.jpg` → 200 image/jpeg) and linked from MCP `explain_score.street_view.image_url` (`mcp/src/config.ts:10-12`). Google Maps Platform terms restrict storing/caching and redistributing Street View content outside Google's own display. This audit did not re-read the current terms, but no doc in the repo addresses the question, and Google imagery is not in `sources.json` (0 hits for "Street View" as a registered source). | This is the single biggest "automatic failure" exposure in the submission and it is unaddressed. |
| 45 | ~$50 total API budget | Met | $18.71 spent (ledger); cap at $45. | |
| 46 | Territory: provided GeoJSON polygon, ~540 SFH in Ramsey | Partial | No polygon was supplied (`README.md`, `technical-decisions.md:9`); `pipeline/select_territory.py` chose one: `data/territory.geojson` with `sfh_count: 542`. The pipeline then finds 569 doors because 27 Allendale homes fall inside the hull. | Defensible, but if the graders' hidden test set is keyed to *their* polygon, nothing here overlaps it by construction. |
| 47 | Deliverables: map UI, MCP (3 tools), eval results (P/R, hallucination, cost/door), one-page rationale | Met | All four exist and are live/committed. | With the caveats in 2, 17, 31. |

### I. Submission deliverables

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 48 | AI usage documentation / AI usage log | Met | `docs/ai-usage-log.md`: models per stage, prompt versions, assistants used in the build. | Says "confidence gate 0.6 before anything reaches the score" (`:10`); code is 0.5 (`score.py:154`, `score_satellite.py:9`, `neighborhood.py:15`). |
| 49 | Source code | Met | This repository; `README.md:14` links the source host. | |
| 50 | Technical documentation | Met | `README.md`, `docs/technical-decisions.md`, `docs/cost-optimization.md`, `mcp/README.md`, `web/README.md`. | `web/README.md:3-4` still says "CARTO Positron raster basemap"; code uses OpenFreeMap (`MapView.tsx:22-24`). README "Caveats of the deployed copy" says the ledger is gitignored and `spent_usd` starts at 0 on Railway; the ledger is tracked (`git ls-files data/cache/cost_ledger.jsonl`) and live `/api/status` reports `total_usd: 18.7111`. |
| 51 | Demo video | Partial | `demo-video/door-score-demo.mp4` (23.8 MB) exists on disk with its recorder scripts and narration, but `git status` shows `demo-video/` untracked and no doc links to a hosted video (`grep -ri video README.md docs/` → only the PRD). | The narration (`demo-video/narration.json`) uses correct figures (569 doors, 17 movers, 24 absentee, 526 usable). `docs/demo-script.md` does not: see section 3. |
| 52 | Test results | Met | `docs/test-results.md` + `data/eval/results_*.json` + 88 unit tests. | The "Cost" table in `docs/test-results.md` does not add up: 3.98 + 1.14 + 9.89 + 4.57 + 0.86 = 20.44, not the stated 18.71. Sonnet production vision is 4.81 + 4.32 = **9.13** (not 9.89; 9.99 is Sonnet's total including discovery) and eval spend is 1.87 + 1.73 = **3.60** (not 4.57). |

**Status counts (52 items): Met 36 · Partial 13 · Not met 1 · Cannot verify 2.**

---

## 2. Gaps and risks, ranked by severity

| Rank | Gap | Why it matters | Suggested fix | Effort |
|---|---|---|---|---|
| 1 | **Street View imagery stored, committed and re-served from the project's own domain** (569 JPEGs in `web/public/img/streetview/`, `/img/streetview/*.jpg` live, linked from MCP). Google imagery is not registered in `sources.json` and no doc discusses its terms. | The PRD makes ToS violations an automatic judgment failure. Even if it is ultimately permitted, the submission has no answer ready. | Read the current Google Maps Platform terms for Street View Static API caching/redistribution. If storage beyond a short cache or self-hosting is not allowed: remove the JPEGs from git, keep only the vision JSON, and render the photo at view time from a Street View Static URL (metadata `pano_id` is already cached) or drop the photo. Register Google imagery in `sources.json` with its `tos_note`. | 1-2 h |
| 2 | **Top-signal eval rests on one positive; satellite signals (17 points) have no human eval.** `provider_truck` P/R 1.00 with tp=1; pool/solar/play/roof are scored from model-only output. | "Vision quality measured by evals" is 25% of the grade; the hidden test set will expose any over-assertion. | (a) Label ~100 satellite tiles via the existing labeler (Sonnet predictions are cached, so $0 except human time); (b) grow the truck/moving support by labeling the model's top-confidence candidates across all 569 frames plus a second heading for ~50 lots (~$0.35 imagery + ~$0.45 vision); (c) report the usability false-positive rate (0.30) alongside the other hallucination numbers. | 3-5 h |
| 3 | **`make all` / `make pipeline` / README `python -m doorscore.run` drop vision on a fresh clone** because `Makefile:15` gates `--vision` on gitignored JPEGs; `make sync` then overwrites the deploy data with vision-less scores. Verified: `make -n pipeline` → no `--vision`. | Contradicts the reproducibility claim and can silently regress the deployed dataset. | Gate on `data/cache/vision/*.json` or always pass `--vision` (the stage is cache-first and capped); make README's first command `--vision`. Add a guard in `sync` that refuses if `doors_with_imagery == 0` while vision caches exist. | 15 min |
| 4 | **Numbers in the docs disagree with the data** (cost per door "about a cent" vs $0.0251; cost table sums to $20.44 not $18.71; gate 0.6 vs 0.5; "14 fields changed" vs 60; demo script scores 83/71 vs 72/61, 26 absentee vs 24, route 114 min vs 116; ledger "gitignored" vs tracked). | "Defensible in Q&A" is an explicit rubric line; a grader who checks one number will check all of them. | Regenerate every figure from `run_report.json`, the ledger and `results_*.json`; have `eval/report.py` also emit the cost table; delete `docs/demo-script.md` numbers that are not produced by a script. | 1 h |
| 5 | **Entity resolution across messy address formats is not exercised and no match rate exists.** All joins are block/lot; `normalize_address` is only used for the owner-occupied flag. | Explicitly named in the rubric. | Report the owner-mailing vs property address match statistics as a first metric (545 same / 24 different / 0 unresolved). Then add one address-keyed source (the SR1A sales file or permit addresses) and report matched / unmatched / ambiguous. | 2-4 h |
| 6 | **Discovery agent output is not consumed by the pipeline**; harvesters are hand-wired; of 14 ToS-ok sources 3 are used. | "How much runs without you" and "agent design" are both graded. | Have `run.py` read `sources.json` and enable harvesters by `data_type`/URL, or at minimum print which registered sources are wired/unwired. Document the deliberate boundary. | 2 h |
| 7 | **Deployed console API holds all three paid keys** (`/api/status` → `keys: anthropic true, google true, census true`) and will run paid stages for anyone with the token, up to $45 cap minus $18.71 spent. | A leaked token spends ~$26 of the budget. | Set `MAX_SPEND_USD` on Railway to the current ledger total plus a small margin, or remove `ANTHROPIC_API_KEY`/`GOOGLE_MAPS_API_KEY` from the deployed service (the hosted console only needs `tests`, `eval` and route planning, which are free). | 10 min |
| 8 | **Local absolute paths leak into public data** (`vision.image.path`, `satellite.image.path` for all 569 doors in the live geojson and MCP data). | Hygiene; exposes a developer path on a public endpoint. | Store the path relative to the repo root or drop it from `image` before writing `doors.json`. | 10 min |
| 9 | **Demo video is untracked and unlinked.** | Required deliverable; a grader cannot find it from the repo. | Upload, link from README; commit `demo-video/` scripts (not the 50 MB WAV). | 15 min |
| 10 | **Score denominator rescaling** makes doors without usable imagery compete on fewer signals; combined with percentile colouring, 4 of the top 5 doors are in Allendale (27 of 569 doors) and #1 has `image_usable: false`. | Will be probed as "does missing imagery help a door?". | Keep the rescale but report, per door, how many points were "available"; or cap the imagery-less rescale at the territory median imagery contribution. | 1 h |
| 11 | Minor: `tax_exempt_residence` published for 4 doors while docs say exemption status is never used; `explain_score` has no map deep link though the demo script says so; `mcp/README.md` says satellite blocks are "not yet surfaced"; `web/README.md` names the old basemap; prompt caching and Message Batches are untested against the API. | Credibility. | Fix the docs; drop `tax_exempt_residence` from the public output; run one 2-call probe for caching and one small batch. | 1 h |

---

## 3. Doc claims not confirmed, and claims that are wrong

Wrong (contradicted by code or data):

- `README.md:183` "Still about a cent per door all-in"; `docs/demo-script.md:53` "under a cent per door, all in"; `Makefile:17` "~$0.011/door". Measured: **$0.0251/door** (`run_report.json`), $0.016 for the two LLM calls alone.
- `docs/test-results.md` cost table: rows sum to $20.44 against a stated $18.71 total; "Vision, production model ... 9.89" should be 9.13; "Eval ... 4.57" should be 3.60.
- `docs/ai-usage-log.md:10` "confidence gate 0.6". Code and every other doc: 0.5.
- `docs/test-results.md` "14 fields changed across 98 rows" after human review. Diff of `sample.jsonl` vs `labels.jsonl`: 60 value changes.
- `docs/demo-script.md`: "#1 door: 3 Larkwood Dr, score 83" (actual 72); "#2: 117 Quillfeather Ave, score 71" (actual rank 4, score 61); "26 doors" absentee (24); plan_route "15 stops, 114 minutes, 24 walking" (live: 15 / 116.2 / 26.2 with default start; 9 stops / 81.6 min with the scripted `start_point` and `min_score` 55); "`explain_score` ... plus a deep link into the map" (no `explain_url` in `explain_score`).
- `README.md` "Caveats of the deployed copy: the cost ledger is gitignored, so `spent_usd` starts at 0 there" and "running the `pipeline` stage on Railway rescores without vision signals". The ledger is tracked and the live `/api/status` reports $18.71; the live `/api/stages` `pipeline` stage includes `--vision` with `warning: null`.
- `web/README.md:3-4` "free CARTO Positron raster basemap". Code: OpenFreeMap vector style.
- `mcp/README.md` "Future `satellite` and `neighborhood` blocks ... not yet surfaced". They are surfaced through `signals[]` in every `explain_score` response (verified live: 17 signals including `swimming_pool`, `block_activity`).
- `docs/door-score-rationale.md:28` and `score.py:129` "93% of doors land between 20 and 50". Data: 94.0%. Trivial, but it is the kind of number a grader recomputes.

Not confirmable from the repo:

- "Hidden labeled test set" performance (7) - no outcomes or labels beyond the 98.
- "Model comparisons reuse cached predictions" is true, but the Sonnet eval predictions are the production predictions on the same images; the eval sample was drawn partly from doors the production model flagged (`eval/sample.py:28-32`, `--add-positives`), so precision on rare signals is measured on a model-selected sample. The docs say this; it is still not an out-of-sample number.
- Prompt caching effect (`cache_control`) and Message Batches path: both marked unverified/not exercised by the authors; no ledger row has `cache_read_tokens > 0` or `batch: true`.
- "Human then reviewed every image" - all 98 rows carry `verified_by_human: true`; the review itself cannot be audited beyond the 60 field edits.
- Map rendering and console interactions were verified by HTTP/data only, not by driving a browser.

---

## 4. Assessment against the four 25% dimensions

**Data engineering (coverage, entity resolution, pipeline autonomy).** Coverage is complete and measured. The parcel spine, permits by block/lot, Census by tract and two imagery stages all run from one command with real caching (verified at $0 and 1.2 s). The weak legs are entity resolution, which the pipeline never actually performs across sources, and the Makefile gate that silently drops vision on a fresh clone. Likely Q&A: "Show me your address match rate." "What happens when a permit address does not carry block/lot?" "Why 569 doors when the brief says ~540?" "Run `make all` from a clean clone; are the scores the same as the deployed ones?" (today: no).

**AI engineering (vision quality by evals, cost discipline, agent design).** The eval harness is real code, drove three concrete decisions, and reports P/R/F1/hallucination plus a threshold sweep per model. Cost discipline is visible in code, not just claimed: free metadata pre-check, cache-before-ledger, metadata-keyed cache, hard cap, batch path. The problems are statistical, not structural: the top signal has one positive, the overhead signals have zero human labels, and the threshold was tuned on the reported set. Likely Q&A: "Your top-signal precision is 1.00 on n=1; what is the confidence interval?" "Pools contribute 6 points to 58 doors with no eval - why are they in the score?" "Why is the usability false-positive rate (30%) not in the report?" "What did Haiku get wrong that Sonnet got right, image by image?"

**Judgment (ICP reasoning, score defensibility, ethics).** The ICP translation is explicit and every signal carries its trait. Dropping `professional_landscaping` after the eval, and keeping yard signs at 3 points because precision was 0.67, are the strongest judgment evidence in the repo. Ethics handling of owner identity is careful and verifiable in code. The unaddressed risk is the Street View imagery storage and redistribution, which sits directly under the PRD's "scraping outside ToS" clause. Likely Q&A: "Under what terms are you storing and serving Google's photographs of these houses?" "Why does an unphotographed house with no imagery negatives rank #1?" "Defend 25 points for a deed within 12 months versus 8 for a provider truck on site." "You publish assessed value, annual tax and a photo per address on an open endpoint - what is the homeowner-facing posture?"

**Shipped quality (deployed, working MCP + map, demo).** This is the strongest dimension. Three Railway services answered every probe; the MCP server is stateless Streamable HTTP with six tools, fuzzy address matching with helpful not-found candidates, and a route planner that returns ordered stops with talking points and a Maps link. The console adds live stage runs with a cost gate. The demo video exists but is not in the repo or linked, and the written demo script reads out stale numbers. Likely Q&A: "Where is the video?" "Why does a 2-hour route return 15 doors instead of 20?" "What does the map do when the basemap provider changes terms again?"

Overall: a working, honest, well-instrumented system whose documentation has drifted from its data in a dozen places, with one unexamined ToS exposure and an eval that is structurally sound but numerically thin exactly where the PRD looks hardest.
