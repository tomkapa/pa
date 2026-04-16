// ---------------------------------------------------------------------------
// LSP Client — JSON-RPC transport layer
//
// Spawns a language server child process and speaks JSON-RPC 2.0 over its
// stdin/stdout using vscode-jsonrpc. Knows nothing about LSP operations or
// tool schemas — just how to send requests/notifications and shut down.
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process'
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node'
import type {
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
} from 'vscode-languageserver-protocol'

export interface LSPClientStartOptions {
  env?: Record<string, string>
  cwd?: string
}

export interface LSPClient {
  readonly capabilities: ServerCapabilities | undefined
  readonly isInitialized: boolean
  readonly connection: MessageConnection | undefined
  start(
    command: string,
    args: string[],
    options?: LSPClientStartOptions,
  ): Promise<void>
  initialize(params: InitializeParams): Promise<InitializeResult>
  sendRequest<T>(method: string, params: unknown): Promise<T>
  sendNotification(method: string, params: unknown): Promise<void>
  stop(): Promise<void>
}

export function createLSPClient(serverName: string): LSPClient {
  let childProcess: ChildProcess | undefined
  let connection: MessageConnection | undefined
  let capabilities: ServerCapabilities | undefined

  return {
    get capabilities() {
      return capabilities
    },
    get isInitialized() {
      return capabilities !== undefined
    },
    get connection() {
      return connection
    },

    async start(command, args, options) {
      if (connection) return // Already started

      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...options?.env },
        cwd: options?.cwd,
      })
      childProcess = child

      // Wait for the process to actually spawn (or fail with ENOENT etc.)
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          child.removeListener('error', onError)
          resolve()
        }
        const onError = (err: Error) => {
          child.removeListener('spawn', onSpawn)
          reject(err)
        }
        child.once('spawn', onSpawn)
        child.once('error', onError)
      })

      const reader = new StreamMessageReader(child.stdout!)
      const writer = new StreamMessageWriter(child.stdin!)
      connection = createMessageConnection(reader, writer)
      connection.listen()
    },

    async initialize(params) {
      if (!connection) {
        throw new Error(`LSP client "${serverName}" not started`)
      }
      const result: InitializeResult = await connection.sendRequest(
        'initialize',
        params,
      )
      capabilities = result.capabilities
      await connection.sendNotification('initialized', {})
      return result
    },

    async sendRequest<T>(method: string, params: unknown): Promise<T> {
      if (!connection) {
        throw new Error(`LSP client "${serverName}" not started`)
      }
      return connection.sendRequest(method, params)
    },

    async sendNotification(method: string, params: unknown) {
      if (!connection) {
        throw new Error(`LSP client "${serverName}" not started`)
      }
      await connection.sendNotification(method, params)
    },

    async stop() {
      if (!connection) return

      try {
        // LSP graceful shutdown: request → notification → dispose
        await connection.sendRequest('shutdown')
        await connection.sendNotification('exit', undefined)
      } catch {
        // Server may already be gone — that's fine
      }

      connection.dispose()
      connection = undefined
      capabilities = undefined

      if (childProcess) {
        childProcess.kill()
        childProcess.removeAllListeners()
        childProcess = undefined
      }
    },
  }
}
