// Starts the built server on a scratch port, checks /health, lists tools, calls get_door_score, exits non-zero on failure.
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.env.SMOKE_PORT ?? '3399'
const base = `http://127.0.0.1:${port}`

const child = spawn(process.execPath, ['dist/server.js'], { cwd: root, env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
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
const expected = ['explain_score', 'get_door_score', 'list_top_doors', 'plan_route', 'territory_stats']
if (JSON.stringify(names) !== JSON.stringify(expected)) fail(`tools/list returned ${JSON.stringify(names)}`)
console.log(`tools/list ok: ${names.join(', ')}`)

const call = await rpc('tools/call', { name: 'get_door_score', arguments: { address: '107 E Ashgrove Street' } }, 2)
const payload = JSON.parse(call.result?.content?.[0]?.text ?? '{}')
if (call.result?.isError || payload.found !== true || payload.address !== '107 E ASHGROVE ST') fail(`get_door_score returned ${JSON.stringify(call)}`)
console.log(`tools/call ok: ${payload.address} score ${payload.door_score} rank ${payload.rank}/${payload.total_doors}`)

child.kill()
console.log('SMOKE PASS')
process.exit(0)
