import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express, { type Request, type Response } from 'express'
import { loadDoors } from './data.js'
import { registerDoorTools } from './tools.js'

const PORT = Number(process.env.PORT ?? 3333)
const doors = loadDoors()
console.log(`door-score-mcp: loaded ${doors.length} doors`)

const DESCRIPTION =
  `Door Score MCP server (${doors.length} single-family homes in Ramsey/Allendale, NJ). ` +
  'Connect an MCP client to POST /mcp (Streamable HTTP, stateless). Tools: get_door_score(address) returns a home\'s 0-100 score, rank, tags and top signals with fuzzy address matching; ' +
  'explain_score(address) returns every signal with evidence plus a narrative and field-rep talking points; ' +
  'plan_route(hours, start_point?, max_doors?, min_score?, include_absentee?) builds a time-budgeted walking route with a Google Maps link; ' +
  'list_top_doors(n?, tag?) lists the best doors optionally filtered by tag; territory_stats() summarizes the score distribution, tags and municipalities. ' +
  'GET /health returns {ok, doors}.\n'

function createServer(): McpServer {
  const server = new McpServer({ name: 'door-score', version: '0.1.0' })
  registerDoorTools(server, doors)
  return server
}

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send(DESCRIPTION)
})

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, doors: doors.length })
})

// Stateless: a fresh server + transport per request, nothing retained between calls.
app.post('/mcp', async (req: Request, res: Response) => {
  const server = createServer()
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
