import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'

// ---------------------------------------------------------------------------
// Connection state — discriminated union
// ---------------------------------------------------------------------------

export type MCPServerConnection =
  | { type: 'connected'; name: string; client: Client; capabilities: ServerCapabilities; cleanup: () => Promise<void> }
  | { type: 'failed'; name: string; error: string }

export type ConnectedConnection = Extract<MCPServerConnection, { type: 'connected' }>

// ---------------------------------------------------------------------------
// MCP tool descriptor — shape returned by tools/list
// ---------------------------------------------------------------------------

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
  }
}
