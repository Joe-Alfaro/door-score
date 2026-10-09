> **Console-first version.** Every step below that used to run a script or a curl now happens in the console at https://web-production-39b2a.up.railway.app/console. Paste the run token (top right, "Set run token"; value is `CONSOLE_TOKEN` in `.env`) before recording. The original terminal commands are kept further down as fallbacks.

# Door Score — 4-minute demo script

Spoken lines are short on purpose. Read them; do not improvise numbers. Everything quoted below
comes from `data/out/doors.json`, `docs/test-results.md` and a live `plan_route` call made on
2026-10-08.

## Have open before recording (in this tab order)

1. Terminal at the repo root, `make all` already run once (so the second run is instant and cached).
2. https://web-production-39b2a.up.railway.app (map, loaded, zoomed to the territory).
3. A second terminal with the `plan_route` curl below pasted and ready, plus `jq` installed.
4. `docs/test-results.md` rendered (GitHub or a Markdown preview), scrolled to the **Vision eval** tables.
5. `docs/door-score-rationale.md` scrolled to **What we deliberately do not use**.

Warm up the MCP server right before you hit record (it may be asleep):

```sh
curl -s https://mcp-production-1645.up.railway.app/health
# expect: {"ok":true,"doors":569}
```

---

## 0:00 — The problem and the polygon

Show: `data/territory.geojson` or the territory outline on the map.

> A home-services business wants to know which doors to knock first.
> The input is one polygon. Nothing else.
> No address list was needed: New Jersey's statewide parcel service returns every parcel that intersects the polygon, with its tax record attached.
> 637 parcels came back. 569 are single-family homes. Every one gets a Door Score, zero to one hundred, with evidence a rep can act on.

## 0:30 (console → Pipeline page: click **Run** on *Harvest + score*; it finishes in about a second from cache and the log streams live. Point at the *Imagery + vision* card showing **$0.00** estimate because every image is cached, and the spend bar in the header.)

## 0:30 (original) — The pipeline in one command

Show: terminal.

```sh
make all
```

> One command.
> It pulls parcels and tax records, construction permits by block and lot, Census tract profiles, and Street View imagery already on disk.
> Then it scores every door and copies the output into the map and the MCP server.

Point at the fast re-run:

> Every stage is cached under `data/cache`, keyed by the polygon hash, the image hash, the prompt version and the model.
> Re-running costs nothing unless an input changed.
> Measured spend: under a cent per door, all in.

Optional if the terminal is quiet: `cat data/out/run_report.json | head -40` shows coverage and USD per door.

## 1:15 — The map

Show: https://web-production-39b2a.up.railway.app

> Every dot is a home. Darker means a higher score.
> The stats strip across the top is computed live from the data: 569 doors, new movers, absentee owners, doors with usable imagery.

Click the **#1 door: 3 Larkwood Dr, Allendale, score 83** (search "3 Larkwood" in the top bar, press Enter).
Read the evidence card top to bottom:

> Number one. Score 83.
> Deed dated July 2024, 27 months ago, purchased for about a million dollars. That is a real sale, not a one-dollar transfer.
> Assessed value 973 thousand: top quartile for this territory. Quartiles are relative to the neighbors, not the state.
> Three permits in five years, latest an alteration in June 2025, 55 thousand dollars declared: building, electrical, fire, plumbing. This household already hires out.
> Owner-occupied: the tax bill mails to the house.
> Street View: no clear frontage. The card says so. A missing photo never lowers a score; the door is scored on the signals it has.

Then click **#2: 117 Quillfeather Ave, Ramsey, score 71** (search "117 Quillfeather").

> Here the photo does the work. Capture date July 2025.
> The model saw a compact excavator on site and fresh stone work at the foundation. Permits confirm it: five in five years.
> Tags: provider on site, recent major project, visible wear.

Toggle the tag filters in the top bar:

> Toggle **new mover**: only doors with a recent arm's-length deed.
> Toggle **absentee owner**: 26 doors where the tax bill goes somewhere else. Those score zero on the homeowner signal and are excluded from routes by default.

Turn both toggles back off.

## 2:15 (console → Route planner: set hours to 2, start at 3 Larkwood Dr, click Plan; read the first three stops and talking points from the table, then click *Open in Google Maps*.)

## 2:15 (original) — The MCP server

Show: second terminal. This is the exact `plan_route` call from `mcp/README.md`, pointed at production.

```sh
curl -s -X POST https://mcp-production-1645.up.railway.app/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"plan_route","arguments":{"hours":2,"start_point":"3 Larkwood Dr","min_score":55}}}' \
  | sed -n 's/^data: //p' | jq -r '.result.content[0].text' | jq '{totals, stops: [.stops[:3][] | {order, address, door_score, arrive_minute, talking_point}]}'
```

> The same data is an MCP server, so an assistant can answer: "I have two hours. Which doors, in what order, and what do I say?"
> Two hours, start at 3 Larkwood Drive, minimum score 55.
> It returns 15 stops, 114 minutes, 24 of them walking, and a Google Maps link.

Read the first three stops:

> Stop one, 3 Larkwood Drive, score 83. Talking point: welcome to the neighborhood; ask which home services they are still setting up. Moved in about 27 months ago.
> Stop two, 333 Tessaly Drive, score 58, one minute's walk. Same new-mover opener; moved in about 32 months ago.
> Stop three, 4 Larkwood Drive, score 66. Higher-value home: position a premium or bundled plan, not a one-off job.

> Talking points are generated from the signals. They never describe who lives there.

If you have ten spare seconds: `explain_score` on any address returns every signal with its points, evidence and source, plus a deep link into the map.

## 3:00 (console → Eval page: the two-model table, the threshold-sweep chart, and the labeled gallery. Sources page shows the 20 discovered sources with their ToS and PII columns.)

## 3:00 (original) — The eval

Show: `docs/test-results.md`, Vision eval tables.

> We did not trust the vision model on faith.
> 98 Street View images, every one checked by a human. Per signal: precision, recall and a hallucination rate, for two model tiers, at the production confidence gate.

Point at the `yard_sign` and `professional_landscaping` rows:

> The cheap model asserted a yard sign on 21 percent of images that had none, and professional landscaping on 32 percent. The stronger model brought those to 2 percent and zero. So production moved up a tier, at about twice the vision cost, still under a cent a door.
> One signal was dropped entirely: professional landscaping. The cheap model hallucinated it and the stronger model found none of the three real cases. A signal we cannot measure does not belong in a score a rep acts on.

Point at the gate sweep:

> The 0.5 confidence gate came from this sweep: raising it to 0.6 loses the one real provider truck for no precision gain.

One honest caveat, read as written:

> Positives are rare here. The truck numbers rest on one example. Read them as "no evidence of a problem," not as a measured rate.

## 3:40 — Ethics: what we deliberately do not use

Show: `docs/door-score-rationale.md`, last section.

> Owner names are redacted under New Jersey law. We never request them and we do not route around it.
> The owner's mailing address is used for one bit, owner-occupied or not, and then discarded. It is not in the output.
> No tax-exemption categories, such as a disabled-veteran exemption.
> Nothing that infers race, religion, age or family status of a specific resident. Census data is tract-level only.
> The vision prompt forbids identifying people or reading plates.
> Listing sites whose terms forbid programmatic access are documented as sources and not harvested.
> Every point in the score traces to a public record or a dated photo. That is the whole idea.

End on the map.

---

## Things that can go wrong live

| Risk | What you will see | Do this |
|---|---|---|
| MCP cold start | The curl hangs 10–30 s or returns a Railway "Application failed to respond" page | Hit `/health` once before recording. If it still stalls, run the curl twice; the second call is fast. |
| Map worker fails to load | Page renders the top bar but the map area is blank or grey; console shows a 404 for `maplibre/maplibre-gl-worker.mjs` | Hard refresh (Cmd-Shift-R). The worker URL is set from `BASE_URL` in `web/src/main.tsx`; a stale cache after a deploy is the usual cause. Have a local `cd web && npm run dev` (http://127.0.0.1:5173) as a fallback. |
| Basemap tiles slow | Dots appear over a blank background | Keep talking; CARTO tiles catch up. Do not zoom while waiting. |
| Street View photo missing on a card | Photo area simply hidden (the card hides itself on a 404) | Expected for a few doors. #1 shows a "No clear frontage" overlay by design; #2 (117 Quillfeather Ave) has a usable photo. |
| Stale `professional_landscaping` row on evidence cards | The deployed `doors.json` predates the signal's removal, so cards still list "Professional landscaping 0 / 6" | Either redeploy after `make all` before recording, or skip past the row and say "that signal is being removed; see the eval section." Do not read it out as a scoring signal. |
| Search does not find the door | Empty result list | House number must match. Type "3 Larkwood" not "3 Larkwood Drive, Allendale". |
| `jq` not installed | `command not found` | Drop the two `jq` stages and read the `data:` line raw; the stops are still readable. |
| SSE response looks like garbage | Output begins with `event: message` | Normal: the JSON-RPC result is on the `data:` line, which the `sed` in the command extracts. |
| `make all` tries to spend money | Any `Street View` or `anthropic` line scrolling in the log | It should not: `make all` only uses imagery already cached. If `data/cache/streetview/` is missing, it runs without vision. `make vision` is the paid target; do not run it live. |
| Wrong terminal directory | `No rule to make target` | `make` must run from the repo root, not `pipeline/`. |
