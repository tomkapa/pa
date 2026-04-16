// ---------------------------------------------------------------------------
// LSP Singleton Manager
//
// Lazy initialization singleton for the TypeScript language server.
// Creates the server instance on first use and shuts it down on process exit.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  createLSPServerInstance,
  type LSPServerConfig,
  type LSPServerInstance,
} from './server-instance.js'

// ---------------------------------------------------------------------------
// TypeScript language server configuration
// ---------------------------------------------------------------------------

const TS_SERVER_CONFIG: LSPServerConfig = {
  command: 'typescript-language-server',
  args: ['--stdio'],
  extensionToLanguage: {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
  },
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let serverInstance: LSPServerInstance | undefined

/** Get the current LSP server instance (undefined if not yet created). */
export function getLspServer(): LSPServerInstance | undefined {
  return serverInstance
}

async function startTsServer(): Promise<LSPServerInstance> {
  if (!serverInstance) {
    serverInstance = createLSPServerInstance('typescript', TS_SERVER_CONFIG)
  }
  // Await the in-progress start (handles 'starting' state too — the start()
  // method internally dedups concurrent calls via a shared promise)
  if (serverInstance.state !== 'running') {
    await serverInstance.start(process.cwd())
  }
  return serverInstance
}

/**
 * Ensure an LSP server is running for the given file. Returns the server
 * instance if the file type is supported, or undefined otherwise.
 *
 * Lazily starts the server on first call — subsequent calls return the
 * existing instance if it's healthy.
 */
export async function ensureLspServer(
  filePath: string,
): Promise<LSPServerInstance | undefined> {
  const ext = path.extname(filePath).toLowerCase()
  if (!TS_SERVER_CONFIG.extensionToLanguage[ext]) return undefined
  return startTsServer()
}

/**
 * Eagerly start the TypeScript language server at Claude Code startup,
 * so indexing runs in parallel with the user's typing instead of blocking
 * the first LSP request. Fire-and-forget:
 *
 * - No-op if the cwd has no tsconfig.json (not a TypeScript project)
 * - Silent on failure — if typescript-language-server isn't installed,
 *   the standard install-hint surfaces on first LSP tool call via lazy init
 * - Non-blocking — returns immediately; the server warms up in the background
 */
export function warmupLspServer(): void {
  if (!existsSync(path.join(process.cwd(), 'tsconfig.json'))) return
  startTsServer().catch(() => {})
}

/** Check whether a file extension is supported by any configured LSP server. */
export function isSupportedExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext in TS_SERVER_CONFIG.extensionToLanguage
}

// ---------------------------------------------------------------------------
// Process exit cleanup — prevent orphaned language server processes
//
// 'exit' handlers are synchronous — async work won't complete. Use SIGINT/
// SIGTERM for graceful async shutdown, and 'exit' as a sync fallback that
// force-kills the child process to prevent orphans.
// ---------------------------------------------------------------------------

function gracefulShutdown() {
  serverInstance?.stop().catch(() => {})
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
process.on('exit', () => {
  // Sync-only: kill the child process directly if still alive
  serverInstance?.client.connection?.dispose()
})
