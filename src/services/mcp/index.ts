import { logForDebugging } from '../observability/debug.js'
import { getErrorMessage } from '../../utils/error.js'
import { loadMcpConfig } from './config.js'
import { connectStdio, fetchTools } from './client.js'
import type { MCPServerConnection, ConnectedConnection } from './types.js'
import type { StdioServerConfig } from './config.js'
import type { Tool } from '../tools/types.js'

// ---------------------------------------------------------------------------
// Connection pool — memoized connections keyed by server name
// ---------------------------------------------------------------------------

const connectionPool = new Map<string, MCPServerConnection>()

/**
 * Connect to a single MCP server, memoizing the result. Multiple callers
 * for the same server name share one subprocess.
 */
async function connectToServer(
  name: string,
  cfg: StdioServerConfig,
  cwd: string,
): Promise<MCPServerConnection> {
  const existing = connectionPool.get(name)
  if (existing) return existing

  const conn = await connectStdio(name, cfg, cwd)
  connectionPool.set(name, conn)
  return conn
}

// ---------------------------------------------------------------------------
// Concurrency-limited parallel map
// ---------------------------------------------------------------------------

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      const item = items[i]!
      results[i] = await fn(item)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const LOCAL_CONCURRENCY = 4

/**
 * Load MCP configuration, connect to all configured servers, discover their
 * tools, and return them as pa Tool objects ready for the agent loop.
 *
 * - A missing `mcp.json` returns `[]` silently.
 * - A malformed `mcp.json` logs an error and returns `[]`.
 * - A failing server logs a warning and is skipped — it does NOT block startup.
 */
export async function loadAllMcpTools(cwd: string): Promise<Tool[]> {
  let config
  try {
    config = await loadMcpConfig(cwd)
  } catch (err) {
    logForDebugging(`MCP config error: ${getErrorMessage(err)}`, { level: 'error' })
    return []
  }
  if (!config) return []

  const entries = Object.entries(config.mcpServers)
  if (entries.length === 0) return []

  logForDebugging(`Connecting to ${entries.length} MCP server(s)...`, { level: 'info' })

  const results = await mapConcurrent(
    entries,
    LOCAL_CONCURRENCY,
    async ([name, cfg]) => {
      const conn = await connectToServer(name, cfg, cwd)
      if (conn.type !== 'connected') {
        logForDebugging(`MCP server '${name}' failed to connect: ${conn.error} — skipping`, { level: 'warn' })
        return []
      }
      try {
        const tools = await fetchTools(conn)
        logForDebugging(`Connected to MCP server '${name}' — ${tools.length} tool(s) loaded`, { level: 'info' })
        return tools
      } catch (err) {
        logForDebugging(`MCP server '${name}' tool discovery failed: ${getErrorMessage(err)}`, { level: 'warn' })
        return []
      }
    },
  )

  return results.flat()
}

/**
 * Shut down all connected MCP servers. Call on pa exit to avoid leaking
 * subprocesses. Idempotent — clears the pool first, so concurrent or
 * repeated calls are safe.
 */
export async function shutdownAllMcpServers(): Promise<void> {
  const connections = Array.from(connectionPool.values())
  connectionPool.clear()

  await Promise.allSettled(
    connections
      .filter((c): c is ConnectedConnection => c.type === 'connected')
      .map(async (c) => {
        try {
          await c.cleanup()
          logForDebugging(`MCP server '${c.name}' shut down`, { level: 'debug' })
        } catch (err) {
          logForDebugging(`MCP server '${c.name}' shutdown error: ${getErrorMessage(err)}`, { level: 'warn' })
        }
      }),
  )
}

/**
 * Get the current connection state of all known servers.
 * Useful for status commands.
 */
export function getAllConnections(): MCPServerConnection[] {
  return Array.from(connectionPool.values())
}
