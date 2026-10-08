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
| `explain_score`   | `address: string`                                                         | every signal with points/evidence/source, narrative, talking points |
| `plan_route`      | `hours: number`, `start_point?: string`, `max_doors?: number` (20), `min_score?: number` (50), `include_absentee?: boolean` (false) | ordered stops, totals, Google Maps URL |
| `list_top_doors`  | `n?: number` (20), `tag?: string`                                         | top doors, optional tag filter |
| `territory_stats` | none                                                                      | count, score quartiles, tag counts, municipality breakdown, signal coverage |

Address matching is fuzzy (case, punctuation, `Street`/`St`, `East`/`E`, trailing
`, Ramsey, NJ 07446` all tolerated) but the house number must match.
`start_point` for `plan_route` may be a dataset address, a `"lat,lng"` string, or omitted.

## Run locally

```sh
cd mcp
npm install
npm run build      # runs sync-data (copies ../data/out/doors.json -> data/doors.json) then tsc
npm start          # http://localhost:3333/mcp  (PORT and DOORS_PATH env vars override defaults)
npm run smoke      # starts the built server, checks /health, tools/list, and one tools/call
npm run dev        # tsx src/server.ts without building
```

Environment:

- `PORT` (default `3333`)
- `DOORS_PATH` (default `./data/doors.json`)
- `DOORS_SOURCE` (sync-data only; default `../data/out/doors.json`)

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
    tools.ts           registers the 5 MCP tools (zod schemas)
    address.ts         address normalization + fuzzy index (shared by all tools)
    talking-points.ts  talking points + narrative templates (shared by all tools)
    route.ts           greedy selection + 2-opt route planner
    geo.ts             haversine, walking time, "lat,lng" parsing
    data.ts            loads doors.json
    types.ts           Door / Signal interfaces
  scripts/
    sync-data.mjs      copies ../data/out/doors.json -> data/doors.json
    smoke.mjs          end-to-end smoke test
  Dockerfile, railway.json
```
