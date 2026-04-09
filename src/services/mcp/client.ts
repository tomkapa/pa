import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  ListToolsResultSchema,
  CallToolResultSchema,
  ListRootsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { TextBlockParam, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { z } from 'zod'
import { logForDebugging } from '../observability/debug.js'
import { getErrorMessage } from '../../utils/error.js'
import { PA_VERSION } from '../../version.js'
import { withTimeout } from './timeout.js'
import type { StdioServerConfig } from './config.js'
import type {
  MCPServerConnection,
  ConnectedConnection,
  McpToolDescriptor,
} from './types.js'
import type { Tool, ToolResultBlockParam } from '../tools/types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 30_000
const TOOL_CALL_TIMEOUT_MS = 120_000
/** Cap stderr accumulation at ~64 MiB (measured in UTF-16 chars, not bytes). */
const MAX_STDERR_CHARS = 64 * 1024 * 1024
/** Anthropic API tool-name limit. */
const MAX_TOOL_NAME_LENGTH = 64

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a name for the LLM API tool-name constraint:
 * `^[a-zA-Z0-9_-]{1,64}$`. Any invalid character becomes `_`.
 */
export function normalizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function buildMcpToolName(server: string, tool: string): string {
  const raw = `mcp__${normalizeName(server)}__${normalizeName(tool)}`
  return raw.slice(0, MAX_TOOL_NAME_LENGTH)
}

// ---------------------------------------------------------------------------
// Connect to a stdio MCP server
// ---------------------------------------------------------------------------

export async function connectStdio(
  name: string,
  cfg: StdioServerConfig,
  cwd: string,
): Promise<MCPServerConnection> {
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
    stderr: 'pipe',
  })

  // Capture stderr for debugging. Bound the buffer so a broken server can't OOM pa.
  let stderrBuf = ''
  transport.stderr?.on('data', (d: Buffer) => {
    if (stderrBuf.length < MAX_STDERR_CHARS) stderrBuf += d.toString()
  })

  const client = new Client(
    { name: 'pa', version: PA_VERSION },
    { capabilities: { roots: {} } },
  )

  // Some servers (e.g. filesystem-mcp) REQUIRE a roots handler to initialize.
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [{ uri: `file://${cwd}` }],
  }))

  try {
    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      () => { transport.close().catch(() => {}) },
    )
    if (stderrBuf) {
      logForDebugging(`[mcp:${name}] stderr during connect: ${stderrBuf}`, { level: 'debug' })
    }
    return {
      type: 'connected',
      name,
      client,
      capabilities: client.getServerCapabilities() ?? {},
      cleanup: async () => { await client.close() },
    }
  } catch (err) {
    if (stderrBuf) {
      logForDebugging(`[mcp:${name}] stderr: ${stderrBuf}`, { level: 'debug' })
    }
    logForDebugging(`[mcp:${name}] connection failed: ${getErrorMessage(err)}`, { level: 'error' })
    return { type: 'failed', name, error: getErrorMessage(err) }
  }
}

// ---------------------------------------------------------------------------
// Discover tools from a connected server
// ---------------------------------------------------------------------------

export async function fetchTools(conn: ConnectedConnection): Promise<Tool[]> {
  if (!conn.capabilities?.tools) return []

  const res = await conn.client.request(
    { method: 'tools/list' },
    ListToolsResultSchema,
  )
  return res.tools.map(t => wrapMcpTool(conn, t as McpToolDescriptor))
}

// ---------------------------------------------------------------------------
// Wrap an MCP tool as a pa Tool
// ---------------------------------------------------------------------------

/**
 * Passthrough Zod schema for MCP tools. Actual validation is done by the
 * remote MCP server — this exists only to satisfy the Tool interface's
 * `inputSchema` field and will never reject input.
 */
const mcpPassthroughSchema = z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>

/** The output type for MCP tools — matches ToolResultBlockParam['content']. */
type McpToolOutput = ToolResultBlockParam['content']

function wrapMcpTool(conn: ConnectedConnection, mcp: McpToolDescriptor): Tool<Record<string, unknown>, McpToolOutput> {
  const fullName = buildMcpToolName(conn.name, mcp.name)

  return {
    name: fullName,
    isMcp: true,
    mcpInfo: { serverName: conn.name, toolName: mcp.name },
    inputSchema: mcpPassthroughSchema,
    inputJSONSchema: mcp.inputSchema,
    maxResultSizeChars: 100_000,

    isReadOnly: () => mcp.annotations?.readOnlyHint ?? false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    checkPermissions: () => Promise.resolve({ behavior: 'passthrough' as const }),
    userFacingName: () => `${conn.name} - ${mcp.annotations?.title ?? mcp.name} (MCP)`,

    async prompt() {
      return mcp.description ?? `MCP tool ${mcp.name} from server ${conn.name}`
    },

    async description(_input) {
      return mcp.description ?? mcp.name
    },

    async call(args, _ctx) {
      return callWrappedMcpTool(conn, mcp, args)
    },

    mapToolResultToToolResultBlockParam(
      output: McpToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: output,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Call an MCP tool
// ---------------------------------------------------------------------------

async function callWrappedMcpTool(
  conn: ConnectedConnection,
  mcp: McpToolDescriptor,
  args: Record<string, unknown>,
): Promise<{ data: McpToolOutput }> {
  const result = await withTimeout(
    conn.client.callTool(
      { name: mcp.name, arguments: args },
      CallToolResultSchema,
    ),
    TOOL_CALL_TIMEOUT_MS,
  )

  // The SDK's index signature (`[x: string]: unknown`) causes `content` to
  // widen to `unknown`. It's actually always an array of content blocks.
  const content = result.content as Array<{ type: string; [key: string]: unknown }>

  if (result.isError) {
    const errorText = firstText(content) ?? 'MCP tool returned error'
    throw new Error(errorText)
  }

  return { data: toPaContent(content) }
}

// ---------------------------------------------------------------------------
// Content transformation — MCP ContentBlock[] → Anthropic ToolResultBlockParam content
// ---------------------------------------------------------------------------

function toPaContent(
  blocks: Array<{ type: string; [key: string]: unknown }>,
): McpToolOutput {
  if (blocks.length === 0) return '(no output)'

  const textBlocks: TextBlockParam[] = []
  const imageBlocks: ImageBlockParam[] = []

  for (const block of blocks) {
    if (block.type === 'text' && typeof block['text'] === 'string') {
      textBlocks.push({ type: 'text' as const, text: block['text'] as string })
    } else if (block.type === 'image' && typeof block['data'] === 'string' && typeof block['mimeType'] === 'string') {
      imageBlocks.push({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: block['mimeType'] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: block['data'] as string,
        },
      })
    } else {
      logForDebugging(`Unknown MCP content block type: ${block.type}`, { level: 'debug' })
    }
  }

  if (imageBlocks.length === 0) {
    if (textBlocks.length === 0) return '(no output)'
    return textBlocks.map(b => b.text).join('\n')
  }

  return [...textBlocks, ...imageBlocks]
}

function firstText(
  content: Array<{ type: string; [key: string]: unknown }>,
): string | undefined {
  for (const block of content) {
    if (block.type === 'text' && typeof block['text'] === 'string') {
      return block['text'] as string
    }
  }
  return undefined
}
