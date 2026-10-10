# AI usage log

Two kinds of AI use are documented here: AI **in the product** (models the pipeline calls) and AI
**in the build** (assistants used to write the code).

## AI in the product

| Stage | Model | Why this tier | Prompting | Cost control |
|---|---|---|---|---|
| Vision detection (569 images) | `claude-sonnet-5-5` (started on `claude-haiku-4-5`) | Started on the cheapest tier; the eval on 98 human-verified images showed Haiku hallucinating landscaping on 32% and yard signs on 21% of negatives vs ≤2% for Sonnet, so production moved up one tier at ~2× vision cost | Structured output (Pydantic schema), confidence per detection, explicit "report absence" instruction, no identification of people | One image per door, cached by door + pano id + prompt version + model (image-hash fallback); confidence gate 0.5 before anything reaches the score |
| Satellite detection (569 tiles) | `claude-sonnet-5-5` | Same tier as street-level production; pools and solar are unambiguous from above | Separate schema (pool, solar, play equipment, detached structure, roof, tree cover); "only the central lot"; explicit confusers (skylights ≠ solar, fire pit ≠ trampoline) | One 640px zoom-20 tile per door at $0.002, cached; vision cached by door + zoom + prompt version + model |
| Overhead re-run with parcel outline (569 tiles) | `claude-sonnet-5-5` via Message Batches | Human labeler could not tell which lot to judge; drawing the parcel boundary on the tile fixed neighbor-lot false positives (pool P/R 0.91/0.94 → 0.97/0.97) | Prompt `sat-v3-outline`: judge only inside the yellow outline | Batch API at 50%: $1.21 for 569 tiles in 7 minutes |
| Eval draft labels (98 images) | `claude-opus-5-5` | Deliberately a different and stronger model than the detector, so the eval is not the detector grading itself; every draft is then verified by a human | Same schema and prompt as production | Run once; cached |
| Eval model comparison (98 images) | `claude-sonnet-5-5` | Mid tier, to measure whether precision/recall gains justify ~2× cost | Same | Cached |
| Source discovery agent | `claude-sonnet-5-5` + web search tool | One-off research task; mid tier is sufficient | Tool `register_source` with strict schema, ToS and PII fields required per source | `max_uses` on web search; single run |

Spend is recorded per call in `data/cache/cost_ledger.jsonl` and summarized in `data/out/run_report.json`.
Running total at time of writing: see `run_report.json → cost`.

### Prompt versions
- Vision `v1`: initial six detections. `v2`: added `moving_indicators` (PODS containers, moving trucks, sold signs) after a proof-of-concept run surfaced PODS containers; tightened `professional_landscaping` to require crew-level evidence after v1 flagged 17 of 25 lawns.

## AI in the build

- Claude Code (Claude Fable 5.1) was the primary coding assistant for the entire repository, operating as an agent with shell access.
- Independent chunks were delegated to Claude subagents: the React map UI, the MCP server, and the evidence-card photo work. Each subagent's output was reviewed and tested by the primary session; one real defect was found that way (MapLibre worker resolution broke under Vite, fixed in `web/src/main.tsx` and `web/scripts/sync-data.mjs`).
- Human decisions throughout: polygon placement, PII posture (never store owner names or mailing addresses), cheap-first model policy, Railway hosting, label verification, and all go/no-go calls on spend and deployment.
- Where the assistant's output was wrong or incomplete it is noted in commit messages and in `docs/test-results.md`.
