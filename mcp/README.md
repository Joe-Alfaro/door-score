# Door Score MCP server

Remote MCP server (Streamable HTTP, stateless) that exposes the Door Score dataset
(~569 single-family homes in Ramsey/Allendale, NJ) to AI assistants used by field reps.

## Endpoints

| Method | Path      | Purpose                                                     |
| ------ | --------- | ----------------------------------------------------------- |
| POST   | `/mcp`    | MCP JSON-RPC (Streamable HTTP). Send `Accept: application/json, text/event-stream`. |
| GET    | `/health` | `{ "ok": true, "doors": 569 }`                              |
| GET    | `/`       | Plain-text description of the tools                         |

## Tools

| Tool              | Arguments                                                                 | Returns |
| ----------------- | ------------------------------------------------------------------------- | ------- |
| `get_door_score`  | `address: string`                                                         | score, rank, tags, top 3 signals (or closest candidates) |
| `explain_score`   | `address: string`                                                         | every signal with points/evidence/source, `street_view`, `permits`, `census`, narrative, talking points |
| `plan_route`      | `hours: number`, `start_point?: string`, `max_doors?: number` (20), `min_score?: number` (50), `include_absentee?: boolean` (false), `focus?: string[]` | ordered stops (each with `explain_url`), totals, Google Maps URL |
| `list_top_doors`  | `n?: number` (20), `tag?: string`, `municipality?: string`                | top doors, optional tag and municipality filters |
| `territory_stats` | none                                                                      | count, score quartiles, tag counts, municipality breakdown, signal coverage |
| `get_signal_summary` | none                                                                   | per signal: doors with points, mean/max points, sources; vision signals also report usable-imagery share |

Address matching is fuzzy (case, punctuation, `Street`/`St`, `East`/`E`, trailing
`, Ramsey, NJ 07446` all tolerated) but the house number must match.
`start_point` for `plan_route` may be a dataset address, a `"lat,lng"` string, or omitted.
`focus` for `plan_route` is a list of tags; when given, only doors carrying at least one of them are eligible
(the absentee-owner exclusion still applies unless `include_absentee` is true).

### Per-door context fields

Each door in `doors.json` may carry these optional blocks, all surfaced by `explain_score`:

| Field     | Shape | In `explain_score` as |
| --------- | ----- | --------------------- |
| `vision`  | `null` or `{ model, signals: { image_usable, usability_note, provider_truck, moving_indicators, yard_sign, renovation_activity, professional_landscaping, solar_panels, lawn_condition, exterior_condition, roof_condition, vehicles_visible, notes }, image: { date, distance_m, approximate } }`. Each detection is `{ present, confidence, evidence, detail }`. | `street_view: { image_url, date, approximate, distance_m, image_usable, notes }` where `image_url` is `${API_BASE_URL}/api/streetview/<door_id>.jpg` (the console API fetches the frame from Google at view time; nothing is stored) |
| `permits` | `null` or `{ permits_10yr, permits_5yr, cost_5yr, trades_5yr, latest_date, latest_type, latest_cost, months_since_latest, major_project_5yr }` | `permits: { permits_5yr, permits_10yr, cost_5yr, trades_5yr, latest: { date, type, cost, months_ago }, major_project_5yr }` |
| `census`  | `null` or `{ tract_geoid, median_hh_income, dual_earner_share, owner_occupied_share, moved_last_year_share }` (tract-level, never per household) | `census` passed through |

The `satellite` and `neighborhood` blocks are not echoed as objects, but their signals
(`swimming_pool`, `solar_panels`, `play_equipment`, `roof_overhead`, `block_activity`) appear in
`signals[]` of every `explain_score` response alongside the street-level ones (17 signals per door).

Signals now include `provider_truck`, `moving_indicators`, `yard_sign`, `visible_service_need`
(imagery), `permit_history` (permit record) and `dual_income_area` (census tract). Tags may
include `provider on site`, `moving activity`, `recent major project` and `visible wear`.
Talking points are tailored for each of these (moving containers seen in a given month's imagery,
the latest permitted project type and date, which exterior areas show wear, etc.) and never
describe or infer who lives at the address.

Each `plan_route` stop carries `explain_url = ${PHOTO_BASE_URL}/?door=<door_id>`, a deep link
into the companion map.

## Run locally

```sh
cd mcp
npm install
npm run build      # runs sync-data (copies ../data/out/doors.json -> data/doors.json) then tsc
npm start          # http://localhost:3333/mcp  (PORT and DOORS_PATH env vars override defaults)
npm run smoke      # starts the built server, checks /health, tools/list, get_door_score, explain_score, plan_route (focus), get_signal_summary
npm run dev        # tsx src/server.ts without building
```

Environment:

- `PORT` (default `3333`)
- `DOORS_PATH` (default `./data/doors.json`)
- `DOORS_SOURCE` (sync-data only; default `../data/out/doors.json`)
- `PHOTO_BASE_URL` (default `https://web-production-39b2a.up.railway.app`): base of the companion door map; used to build `explain_url`
- `API_BASE_URL` (default `https://api-production-37c4.up.railway.app`): console API that proxies Street View frames at view time; used to build `street_view.image_url`

## Example calls

List tools:

```sh
curl -s -X POST http://localhost:3333/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Call a tool:

```sh
curl -s -X POST http://localhost:3333/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_door_score","arguments":{"address":"107 E Ashgrove Street"}}}'
```

```sh
curl -s -X POST http://localhost:3333/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"plan_route","arguments":{"hours":2,"start_point":"3 Larkwood Dr","min_score":55}}}'
```

Plan a one-hour route restricted to recent movers:

```sh
curl -s -X POST http://localhost:3333/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"plan_route","arguments":{"hours":1,"focus":["new mover"]}}}'
```

Signal coverage across the territory:

```sh
curl -s -X POST http://localhost:3333/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_signal_summary","arguments":{}}}'
```

Responses arrive as `text/event-stream`; the JSON-RPC result is on the `data:` line.
Tool results are JSON encoded in `result.content[0].text`.

## Deploy to Railway

The image bakes `doors.json` in at build time, so the Docker build context must be the
repository root (where `data/out/doors.json` lives), not `mcp/`.

1. Create a Railway service from this repo. Leave **Root Directory** at the repo root.
2. Set **Config-as-code** path to `mcp/railway.json` (or set **Dockerfile Path** to
   `mcp/Dockerfile` manually). The health check is `/health`.
3. Railway injects `PORT`; no other variables are required.
4. Redeploy after re-running the pipeline so the new `data/out/doors.json` is baked in.

Local Docker equivalent:

```sh
# from the repository root
docker build -f mcp/Dockerfile -t door-score-mcp .
docker run --rm -p 3333:3333 door-score-mcp
```

If you would rather deploy with Root Directory = `mcp`, commit `mcp/data/doors.json`
(remove it from `.gitignore`) and change the Dockerfile `COPY` lines to drop the `mcp/`
prefix; `sync-data` already falls back to the existing copy when `../data/out` is absent.

## Layout

```
mcp/
  src/
    server.ts          Express app, /mcp transport, /health, /
    tools.ts           registers the 6 MCP tools (zod schemas)
    config.ts          PHOTO_BASE_URL / API_BASE_URL and the image / explain URL builders
    address.ts         address normalization + fuzzy index (shared by all tools)
    talking-points.ts  talking points + narrative templates (shared by all tools)
    route.ts           greedy selection + 2-opt route planner
    geo.ts             haversine, walking time, "lat,lng" parsing
    data.ts            loads doors.json
    types.ts           Door / Signal / Vision / Permits / Census interfaces
  scripts/
    sync-data.mjs      copies ../data/out/doors.json -> data/doors.json
    smoke.mjs          end-to-end smoke test
  Dockerfile, railway.json
```
