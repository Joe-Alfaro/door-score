// Starts the built server on a scratch port, checks /health, lists tools, calls get_door_score, explain_score,
// plan_route (focused) and get_signal_summary against a small synthetic fixture (no real homes), and checks that
// with no area loaded the tools say so. Exits non-zero on failure.
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.env.SMOKE_PORT ?? '3399'
const base = `http://127.0.0.1:${port}`

const child = spawn(process.execPath, ['dist/server.js'], { cwd: root, env: { ...process.env, PORT: port, DOORS_PATH: resolve(root, 'scripts/fixtures/doors.sample.json'), API_BASE_URL: 'http://127.0.0.1:9' }, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`))
child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`))

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`)
  child.kill()
  process.exit(1)
}

async function waitForHealth(attempts = 40) {
  const tryOnce = async (remaining) => {
    if (remaining === 0) fail('server never became healthy')
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return res.json()
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
    return tryOnce(remaining - 1)
  }
  return tryOnce(attempts)
}

async function rpc(method, params, id) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  if (!res.ok) fail(`${method} -> HTTP ${res.status}: ${await res.text()}`)
  const text = await res.text()
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'))
    if (!dataLine) fail(`${method}: no data frame in SSE response`)
    return JSON.parse(dataLine.slice(5).trim())
  }
  return JSON.parse(text)
}

const health = await waitForHealth()
if (health.ok !== true || typeof health.doors !== 'number' || health.doors < 1) fail(`bad /health payload ${JSON.stringify(health)}`)
console.log(`health ok: ${health.doors} doors`)

const root_ = await fetch(`${base}/`)
if (!root_.ok || !(await root_.text()).includes('get_door_score')) fail('GET / did not describe tools')
console.log('GET / ok')

const list = await rpc('tools/list', {}, 1)
const names = (list.result?.tools ?? []).map((tool) => tool.name).sort()
const expected = ['explain_score', 'get_door_score', 'get_signal_summary', 'list_top_doors', 'plan_route', 'territory_stats']
if (JSON.stringify(names) !== JSON.stringify(expected)) fail(`tools/list returned ${JSON.stringify(names)}`)
console.log(`tools/list ok: ${names.join(', ')}`)

const call = await rpc('tools/call', { name: 'get_door_score', arguments: { address: '107 E Ashgrove Street' } }, 2)
const payload = JSON.parse(call.result?.content?.[0]?.text ?? '{}')
if (call.result?.isError || payload.found !== true || payload.address !== '107 E ASHGROVE ST') fail(`get_door_score returned ${JSON.stringify(call)}`)
console.log(`tools/call ok: ${payload.address} score ${payload.door_score} rank ${payload.rank}/${payload.total_doors}`)

const explain = await rpc('tools/call', { name: 'explain_score', arguments: { address: '3 Larkwood Drive' } }, 3)
const explained = JSON.parse(explain.result?.content?.[0]?.text ?? '{}')
if (explain.result?.isError || explained.found !== true || explained.address !== '3 LARKWOOD DR') fail(`explain_score returned ${JSON.stringify(explain)}`)
if (typeof explained.street_view?.image_url !== 'string' || !explained.street_view.image_url.includes(`/api/streetview/${explained.door_id}.jpg`)) {
  fail(`explain_score missing street_view.image_url: ${JSON.stringify(explained.street_view)}`)
}
if (!Array.isArray(explained.talking_points) || explained.talking_points.length === 0) fail('explain_score returned no talking points')
console.log(`explain_score ok: ${explained.address} street_view ${explained.street_view.image_url} (${explained.street_view.date}), permits ${explained.permits ? explained.permits.permits_5yr : 'n/a'}, census ${explained.census ? explained.census.tract_geoid : 'n/a'}`)

const route = await rpc('tools/call', { name: 'plan_route', arguments: { hours: 1, focus: ['new mover'] } }, 4)
const routed = JSON.parse(route.result?.content?.[0]?.text ?? '{}')
if (route.result?.isError || !Array.isArray(routed.stops) || routed.stops.length === 0) fail(`plan_route returned ${JSON.stringify(route)}`)
const badStop = routed.stops.find((stop) => typeof stop.explain_url !== 'string' || !stop.explain_url.includes(`?door=${stop.door_id}`))
if (badStop) fail(`plan_route stop missing explain_url: ${JSON.stringify(badStop)}`)
console.log(`plan_route ok: ${routed.stops.length} stops from ${routed.parameters.eligible_doors} eligible "new mover" doors, ${routed.totals.total_minutes} min, first explain_url ${routed.stops[0].explain_url}`)

const summary = await rpc('tools/call', { name: 'get_signal_summary', arguments: {} }, 5)
const summarized = JSON.parse(summary.result?.content?.[0]?.text ?? '{}')
if (summary.result?.isError || !Array.isArray(summarized.signals) || summarized.signals.length === 0) fail(`get_signal_summary returned ${JSON.stringify(summary)}`)
const visionSignals = summarized.signals.filter((signal) => signal.vision_signal)
if (visionSignals.some((signal) => typeof signal.usable_imagery_share !== 'number')) fail('get_signal_summary vision signals lack usable_imagery_share')
console.log(`get_signal_summary ok: ${summarized.signals.length} signals, ${visionSignals.length} vision signals, usable imagery ${summarized.imagery.doors_with_usable_imagery}/${summarized.imagery.doors_with_imagery}`)

// A drawn area that cannot be loaded (here: no console API reachable) is a clean JSON-RPC error, not a crash.
const missing = await fetch(`${base}/mcp?territory=does-not-exist`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} }),
})
if (missing.status !== 404) fail(`unknown territory -> HTTP ${missing.status}`)
console.log('unknown territory ok: 404')

child.kill()
console.log('SMOKE PASS')
process.exit(0)
