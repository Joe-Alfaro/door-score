# Technical decisions

One line per decision: what we chose, what we didn't, and why. Dates are 2026-10-08/09.

## Data

- **Polygon is an opaque input; a selector script picked ours.** No polygon was supplied, so `select_territory.py` searched Ramsey for the most compact ~540-home cluster. Alternative: hand-draw one. Tradeoff: reproducible and defensible, and the pipeline never special-cases Ramsey.
- **Parcels via the NJ statewide ArcGIS feature service, queried by geometry.** Alternative: bulk county shapefile. Tradeoff: live, paginated, no download step; cached by polygon hash so re-runs are free.
- **Entity resolution by canonical address string plus block/lot.** Addresses are normalized in code (`DRIVE`→`DR`, `N. J.`→state stripped); permits join on municipality code + block + lot, not on address. Alternative: a paid geocoder. Tradeoff: deterministic, testable (56 unit cases), zero cost; weaker on free-text sources we didn't need.
- **Owner identity is never fetched or stored.** `OWNER_NAME` is excluded from the field list; the mailing address is read only to derive `owner_occupied` and then discarded; tax-exemption classes (e.g. disabled veteran) are never a signal. Alternative: pursue identity data from other sources. Tradeoff: we give up a "named contact" feature that the PRD itself flags as an ethics test.
- **27 Allendale homes kept.** The polygon crosses a border. Alternative: clip to Ramsey. Tradeoff: realistic territories straddle borders, and it exercised cross-municipality handling (different building-code conventions, no-comma city strings).
- **Census joined at tract level only.** Aggregate dual-earner share as a prior with a small weight. Alternative: skip Census (no door-level signal) or block group (noisier). Tradeoff: the only public proxy for "dual-income".
- **Source discovery is an agent with a strict `register_source` tool.** Each source records access method, ToS and PII posture, and gets a reachability probe; runs accumulate. Alternative: hand-list sources. Tradeoff: slower first run (~$0.40) but demonstrably autonomous; only ToS-cleared sources were wired.

## Vision

- **One Street View frame per door, 640 px, radius widened in steps (60→120→200 m).** Alternative: multiple headings. Tradeoff: $0.007/door; big lots need the wider radius, and we flag frames whose camera is >90 m from the lot center.
- **Satellite tile at zoom 20 as a second stage.** Pools, solar and play equipment are unambiguous from above. Alternative: skip. Tradeoff: doubled vision spend (~$4.30) for 58 pools; labels are still model-only (pilot spot-checked by eye).
- **No time-series imagery.** The Static API serves only the latest pano. Alternative: the JavaScript API, a different ToS question. Tradeoff: condition trajectory is out of scope; permit history covers "activity over time".
- **Structured output with a confidence and an evidence string per detection.** Alternative: free-text prompts. Tradeoff: schema-validated JSON, a confidence gate the eval can sweep, and evidence a rep can read.
- **Cheapest model first, then let the eval decide.** Haiku 4.5 ran the territory ($1.87); on 98 human-verified images it hallucinated landscaping on 32% and yard signs on 21% of negatives, so production moved to Sonnet 5.5 (≤2%). A Haiku-screen/Sonnet-confirm cascade was measured and rejected (worse recall, saves ~$1.50). Tradeoff: ~2× vision cost for precision a rep can act on.
- **Confidence gate 0.5, set by the sweep.** At 0.6 the only true truck and most renovations were missed. Caveat recorded: tuned on the same labeled set it is reported on.
- **Professional-landscaping signal removed; yard signs count only when the typed detail names a trade.** Both failed or hedged in the eval. Tradeoff: fewer signals, none we can't defend.
- **Model-drafted labels, human-verified every row.** Opus drafted, a human changed 14 fields across 98 rows. Alternative: label from scratch (slower) or trust the drafts (circular). Sample was stratified to include every rare positive so precision has support.

## Score

- **Additive points per signal, each with a max, rescaled over the signals available to that door.** A door without usable imagery is never penalized relative to one with it. Alternative: a learned model. Tradeoff: no outcomes to train on; every point traces to an evidence line and an ICP trait.
- **Raw score in the card, territory percentile for map colour and sort.** 93% of raw scores sit between 20 and 50. Tradeoff: raw stays comparable across runs; percentile answers "which doors first".
- **Neighborhood effects as a derived signal** (movers, permits, renovations, trucks within 150 m). Alternative: none. Tradeoff: cheap, pure computation; small-denominator sensitivity on short streets.

## Cost

- **Every paid call goes through one ledger; production vs eval spend reported separately.** Measured, not estimated: $0.0251/door all-in.
- **Vision caches keyed by free metadata (door + pano id / zoom), JSON committed, images gitignored.** A fresh clone or a container rescored 569 doors with vision in 0.5 s and $0. Alternative: key by image hash (original). Tradeoff: a one-time migration; now nothing can re-bill the territory by accident.
- **Hard spend cap (`MAX_SPEND_USD`), opt-in Message Batches (50% off), leaner v3 prompt kept behind a flag.** Prompt-version bumps invalidate the cache and re-bill, so they are deliberate.

## Shipping

- **Python for the pipeline, TypeScript + React for the map, console and MCP server.** Geospatial and SDK ergonomics on one side, UI and MCP SDK on the other.
- **MapLibre with a keyless basemap; the worker shipped as a static asset.** Vite rewrote MapLibre's worker URL (blank map in production, found by the integrator, not the builder); CARTO tiles later started demanding a key, so the basemap moved to OpenFreeMap.
- **MCP over Streamable HTTP, stateless; routes by greedy score-per-minute plus 2-opt; talking points from templates, not an LLM.** Tradeoff: deterministic, free, instant; less fluent than generated copy.
- **Console = FastAPI subprocess runner + PrimeReact.** Stages run the same `python -m` commands a reviewer would; runs need a token entered in-app (never baked into the bundle) and refuse to exceed the cap.
- **Three Railway services, data baked into each image.** Alternative: a shared database. Tradeoff: no infra to keep alive for a demo; redeploy is the "refresh".
- **Parallel work via in-session subagents rather than an AO orchestrator.** The orchestrator needs a registered project with a remote; subagents kept one integrator holding the non-obvious context (deed-date pivot, mailing-address rule, cache keys).
