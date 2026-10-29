import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express, { type Request, type Response } from 'express'
import { fetchTerritoryDoors, loadDoors } from './data.js'
import { registerDoorTools } from './tools.js'

const PORT = Number(process.env.PORT ?? 3333)
// No dataset ships with the server. Doors come from the area the user drew in the map
// (POST /mcp?territory=<id>, fetched on demand from the console API) or an optional local DOORS_PATH.
const localDoors = loadDoors()
console.log(`door-score-mcp: ${localDoors.length} local doors; areas load on demand via ?territory=<id>`)

const DESCRIPTION =
  'Door Score MCP server: scores single-family homes inside an area you draw in the Door Score map (NJ). ' +
  'Draw an area in the map, then connect an MCP client to POST /mcp?territory=<id> (Streamable HTTP, stateless), using the id from the share link. Tools: get_door_score(address) returns a home\'s 0-100 score, rank, tags and top signals with fuzzy address matching; ' +
  'explain_score(address) returns every signal with evidence, street-view image link, permit and census context, plus a narrative and field-rep talking points; ' +
  'plan_route(hours, start_point?, max_doors?, min_score?, include_absentee?, focus?) builds a time-budgeted walking route with a Google Maps link and per-stop explain links; ' +
  'list_top_doors(n?, tag?, municipality?) lists the best doors optionally filtered by tag and municipality; territory_stats() summarizes the score distribution, tags and municipalities; ' +
  'get_signal_summary() reports per-signal coverage including usable-imagery share for vision signals. ' +
  'GET /health returns {ok, doors}.\n'

function createServer(doors: typeof localDoors, territoryId?: string): McpServer {
  const server = new McpServer({ name: 'door-score', version: '0.1.0' })
  registerDoorTools(server, doors, territoryId)
  return server
}

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send(DESCRIPTION)
})

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, doors: localDoors.length, areas: 'on demand via /mcp?territory=<id>' })
})

// Stateless: a fresh server + transport per request, nothing retained between calls.
app.post('/mcp', async (req: Request, res: Response) => {
  const territoryId = typeof req.query.territory === 'string' && req.query.territory ? req.query.territory : undefined
  let doors = localDoors
  if (territoryId) {
    try {
      doors = await fetchTerritoryDoors(territoryId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'could not load territory'
      res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null })
      return
    }
  }
  const server = createServer(doors, territoryId)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    console.error('mcp request failed', error)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  }
})

const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST /mcp (stateless Streamable HTTP).' }, id: null })
}
app.get('/mcp', methodNotAllowed)
app.delete('/mcp', methodNotAllowed)

app.listen(PORT, () => {
  console.log(`door-score-mcp listening on http://localhost:${PORT}/mcp`)
})
