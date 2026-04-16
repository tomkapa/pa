// ---------------------------------------------------------------------------
// LSP Server Instance — lifecycle manager
//
// Wraps the LSP client with a state machine and the LSP initialization
// handshake. Manages server health and file synchronization (didOpen).
// Knows about LSP lifecycle but not about tool schemas or model interfaces.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLSPClient, type LSPClient } from './client.js'
import { expandPath } from '../utils/expandPath.js'

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface LSPServerConfig {
  command: string
  args: string[]
  extensionToLanguage: Record<string, string>
}

export interface LSPServerInstance {
  readonly state: ServerState
  readonly client: LSPClient
  readonly config: LSPServerConfig
  start(workspaceFolder: string): Promise<void>
  stop(): Promise<void>
  isHealthy(): boolean
  sendRequest<T>(method: string, params: unknown): Promise<T>
  sendNotification(method: string, params: unknown): Promise<void>
  ensureFileOpen(filePath: string): Promise<void>
}

export function createLSPServerInstance(
  serverName: string,
  config: LSPServerConfig,
): LSPServerInstance {
  let state: ServerState = 'stopped'
  let startPromise: Promise<void> | undefined
  const client = createLSPClient(serverName)
  const openFiles = new Set<string>()

  return {
    get state() {
      return state
    },
    get client() {
      return client
    },
    get config() {
      return config
    },

    async start(workspaceFolder) {
      if (state === 'running') return
      // Dedup concurrent starts — second caller awaits the in-progress promise
      if (startPromise) return startPromise

      state = 'starting'
      startPromise = (async () => {
        await client.start(config.command, config.args, {
          cwd: workspaceFolder,
        })

        // Handle workspace/configuration requests that some servers send
        // even when we don't claim support (e.g. typescript-language-server)
        client.connection?.onRequest(
          'workspace/configuration',
          (params: { items: unknown[] }) => params.items.map(() => null),
        )

        await client.initialize({
          processId: process.pid,
          initializationOptions: {},

          // Modern approach (LSP 3.16+)
          workspaceFolders: [
            {
              uri: pathToFileURL(workspaceFolder).href,
              name: path.basename(workspaceFolder),
            },
          ],

          // Deprecated but required by typescript-language-server for
          // goToDefinition to work correctly
          rootPath: workspaceFolder,
          rootUri: pathToFileURL(workspaceFolder).href,

          capabilities: {
            workspace: {
              configuration: false as unknown as undefined,
              workspaceFolders: false as unknown as undefined,
            },
            textDocument: {
              hover: {
                dynamicRegistration: false,
                contentFormat: ['markdown', 'plaintext'],
              },
              definition: {
                dynamicRegistration: false,
                linkSupport: true,
              },
              references: {
                dynamicRegistration: false,
              },
            },
            general: {
              positionEncodings: ['utf-16'],
            },
          },
        })

        state = 'running'
      })()

      try {
        await startPromise
      } catch (err) {
        state = 'error'
        throw err
      } finally {
        startPromise = undefined
      }
    },

    async stop() {
      if (state === 'stopped' || state === 'stopping') return

      state = 'stopping'
      try {
        await client.stop()
      } finally {
        openFiles.clear()
        state = 'stopped'
      }
    },

    isHealthy() {
      return state === 'running' && client.isInitialized
    },

    async sendRequest<T>(method: string, params: unknown): Promise<T> {
      if (!this.isHealthy()) {
        throw new Error(
          `LSP server "${serverName}" is not healthy (state: ${state})`,
        )
      }
      return client.sendRequest<T>(method, params)
    },

    async sendNotification(method: string, params: unknown) {
      if (!this.isHealthy()) {
        throw new Error(
          `LSP server "${serverName}" is not healthy (state: ${state})`,
        )
      }
      return client.sendNotification(method, params)
    },

    async ensureFileOpen(filePath: string) {
      const resolved = expandPath(filePath)
      const fileUri = pathToFileURL(resolved).href

      if (openFiles.has(fileUri)) return

      const content = await readFile(resolved, 'utf-8')
      const ext = path.extname(resolved).toLowerCase()
      const languageId = config.extensionToLanguage[ext] ?? 'plaintext'

      await this.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: fileUri,
          languageId,
          version: 1,
          text: content,
        },
      })

      openFiles.add(fileUri)
    },
  }
}
