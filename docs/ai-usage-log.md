# AI usage log

Two kinds of AI use are documented here: AI **in the product** (models the pipeline calls) and AI
**in the build** (assistants used to write the code).

## AI in the product

| Stage | Model | Why this tier | Prompting | Cost control |
|---|---|---|---|---|
| Vision detection (569 images) | `claude-sonnet-5-5` (started on `claude-haiku-4-5`) | Started on the cheapest tier; the eval on 98 human-verified images showed Haiku hallucinating landscaping on 32% and yard signs on 21% of negatives vs ≤2% for Sonnet, so production moved up one tier at ~2× vision cost | Structured output (Pydantic schema), confidence per detection, explicit "report absence" instruction, no identification of people | One image per door, cached by image hash + prompt version + model; confidence gate 0.6 before anything reaches the score |
| Eval draft labels (80 images) | `claude-opus-5-5` | Deliberately a different and stronger model than the detector, so the eval is not the detector grading itself; every draft is then verified by a human | Same schema and prompt as production | Run once; cached |
| Eval model comparison (80 images) | `claude-sonnet-5-5` | Mid tier, to measure whether precision/recall gains justify ~2× cost | Same | Cached |
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
