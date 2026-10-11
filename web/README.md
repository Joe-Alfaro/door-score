# Door Score — web UI

Map UI for the Door Score pipeline output (Ramsey, NJ). Vite + React 18 + TypeScript + MapLibre GL JS
on the keyless OpenFreeMap Positron vector style (no API key).

## Run locally

```sh
cd web
npm install
npm run dev        # syncs data, serves on http://127.0.0.1:5173
```

`npm run sync-data` copies `../data/out/doors.geojson` and `../data/territory.geojson` into
`public/data/`, which the app fetches at runtime from `/data/*.geojson`. Both `dev` and `build` run
it first. If a pipeline source is missing but a previously synced copy exists under `public/`, the
script keeps the existing copy and warns. Street View frames are not copied and not served from this
site: they are Google content, so the evidence card loads each one at view time from the console API
(`VITE_API_URL` + `/api/streetview/<door_id>.jpg`), which proxies the frame without storing it.

## Build and serve

```sh
npm run build      # sync-data + tsc + vite build -> dist/
npm start          # serve -s dist -l $PORT (defaults to 3000)
```

## Deploy to Railway (static site)

`railway.json` is included. Set the service root directory to `web/` and Railway will use:

- Build command: `npm run build`
- Start command: `npm start` (Railway injects `PORT`)

Because `sync-data` reads from `../data/`, the repository's `data/out/doors.geojson` and
`data/territory.geojson` must be present in the deploy context (commit them, or commit the synced
copies under `web/public/data/`).

## Console (`/console`)

An operations console built with PrimeReact lives at `/console` (Overview, Pipeline, Sources,
Eval, Doors, Route planner, Ledger). It talks to the pipeline's FastAPI backend; the map at `/`
is unchanged and does not need the backend.

```sh
cd ../pipeline && .venv/bin/uvicorn doorscore.api:app --port 8000   # backend
cd web && npm run dev                                                 # then open /console
```

Configuration is via Vite env vars (copy `.env.example` to `.env`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8000` | Base URL of the console API. |
| `VITE_CONSOLE_TOKEN` | (unset) | Sent as `X-Console-Token` on `POST /api/run/*` and `POST /api/runs/*/cancel`. Required when the backend has `CONSOLE_TOKEN` set; without it the backend only accepts mutations from localhost. |

Notes: the Pipeline page confirms paid stages with their estimate before sending `confirm_paid`;
the run terminal is fed by the `/api/runs/{id}/stream` SSE endpoint. Street View thumbnails in
the Doors drawer come from the same console API proxy, `/api/streetview/<door_id>.jpg`.

## Custom territories

The top bar's **Score your own polygon** button opens a Territory panel with two inputs: draw on
the map (click once per corner, **Finish** closes the ring, needs at least three points) or paste /
upload GeoJSON (a Feature, FeatureCollection or bare Polygon/MultiPolygon). **Score this territory**
posts the polygon to the console API and polls until the run finishes, showing the last three log
lines meanwhile. On success the whole page (dots, stats strip, tag filters, search, evidence cards)
switches to that territory's data, the map fits its bounds, and a banner shows the home count, how
many homes already had cached imagery signals, a copyable share link and **Back to default**.

`/?territory=<territory_id>` deep-links a scored territory. Endpoints used (all under
`VITE_API_URL`): `POST /api/territory`, `GET /api/territory/{id}`,
`GET /api/territory/{id}/doors.geojson`, `GET /api/territory/{id}/territory.geojson`.

## UI

- Top bar: address search (Enter or click a result to fly to it), Top-N select (20/50/100/all)
  that dims doors ranked below N, and tag toggles derived from the tags present in the loaded data,
  most common first (a door is shown if it carries any active tag).
- Stats strip: door count, median score, new movers, absentee owners, doors with usable Street View
  imagery, and doors with a provider on site (all computed from loaded data).
- Map: territory outline, one circle per door colored on a sequential blue scale by `door_score`,
  hover tooltip, click opens the evidence card.
- Evidence card: address, municipality, score, rank, Street View photo (capture date, camera
  distance when approximate, "No clear frontage" overlay when the model found the frame unusable,
  model notes; hidden if the proxy returns an error), tags, "Why this door" (top two signals), generic signals
  list (points/max bar, humanized name, evidence, source, optional `image_url`), and property facts
  including 5-year permit count, latest permit and trades.
