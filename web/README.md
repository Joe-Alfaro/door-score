# Door Score — web UI

Map UI for the Door Score pipeline output (Ramsey, NJ). Vite + React 18 + TypeScript + MapLibre GL JS
on a free CARTO Positron raster basemap (no API key).

## Run locally

```sh
cd web
npm install
npm run dev        # syncs data, serves on http://127.0.0.1:5173
```

`npm run sync-data` copies `../data/out/doors.geojson` and `../data/territory.geojson` into
`public/data/`, which the app fetches at runtime from `/data/*.geojson`. Both `dev` and `build`
run it first. If the pipeline output is missing but a previously synced copy exists in
`public/data/`, the script keeps the existing copy and warns.

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

## UI

- Top bar: address search (Enter or click a result to fly to it), Top-N select (20/50/100/all)
  that dims doors ranked below N, and tag toggles (a door is shown if it carries any active tag).
- Stats strip: door count, median score, new movers, absentee owners (computed from loaded data).
- Map: territory outline, one circle per door colored on a sequential blue scale by `door_score`,
  hover tooltip, click opens the evidence card.
- Evidence card: address, municipality, score, rank, tags, "Why this door" (top two signals),
  generic signals list (points/max bar, humanized name, evidence, source, optional `image_url`),
  and property facts.
