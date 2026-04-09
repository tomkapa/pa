import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { logForDebugging } from '../observability/debug.js'

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const StdioServerConfigSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>

const McpJsonConfigSchema = z.object({
  mcpServers: z.record(z.string(), StdioServerConfigSchema),
})

export type McpJsonConfig = z.infer<typeof McpJsonConfigSchema>

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load MCP server configuration from `mcp.json` in the given directory.
 * Returns null if the file doesn't exist. Throws on malformed JSON so the
 * caller can log and proceed with zero MCP servers.
 */
export async function loadMcpConfig(cwd: string): Promise<McpJsonConfig | null> {
  const configPath = resolve(cwd, 'mcp.json')
  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logForDebugging(`MCP config at ${configPath} is not valid JSON`, { level: 'error' })
    throw new Error(`MCP config at ${configPath} is not valid JSON`)
  }

  const result = McpJsonConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    logForDebugging(`MCP config validation failed: ${issues}`, { level: 'error' })
    throw new Error(`Invalid MCP config at ${configPath}: ${issues}`)
  }

  return result.data
}
