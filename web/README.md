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
`public/data/`, which the app fetches at runtime from `/data/*.geojson`, and mirrors the cached
Street View photos from `../data/cache/streetview/*.jpg` into `public/img/streetview/` (served at
`/img/streetview/<door_id>.jpg`). Both `dev` and `build` run it first. If a pipeline source is
missing but a previously synced copy exists under `public/`, the script keeps the existing copy
and warns. The synced photos are intentionally not gitignored so they deploy with the site.

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
  that dims doors ranked below N, and tag toggles derived from the tags present in the loaded data,
  most common first (a door is shown if it carries any active tag).
- Stats strip: door count, median score, new movers, absentee owners, doors with usable Street View
  imagery, and doors with a provider on site (all computed from loaded data).
- Map: territory outline, one circle per door colored on a sequential blue scale by `door_score`,
  hover tooltip, click opens the evidence card.
- Evidence card: address, municipality, score, rank, Street View photo (capture date, camera
  distance when approximate, "No clear frontage" overlay when the model found the frame unusable,
  model notes; hidden if the image 404s), tags, "Why this door" (top two signals), generic signals
  list (points/max bar, humanized name, evidence, source, optional `image_url`), and property facts
  including 5-year permit count, latest permit and trades.
