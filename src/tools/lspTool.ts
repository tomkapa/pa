// ---------------------------------------------------------------------------
// LSP Tool — semantic code intelligence for the model
//
// Provides goToDefinition, findReferences, and hover operations via the
// Language Server Protocol. Deferred by default — only loaded when the
// model discovers it via ToolSearch.
// ---------------------------------------------------------------------------

import path from 'node:path'
import { z } from 'zod'
import { pathToFileURL } from 'node:url'
import type { Location, LocationLink, Hover } from 'vscode-languageserver-protocol'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { semanticNumber } from '../utils/schema.js'
import { expandPath } from '../utils/expandPath.js'
import { getErrorMessage, isNodeError } from '../utils/error.js'
import {
  ensureLspServer,
  getLspServer,
  isSupportedExtension,
} from '../lsp/manager.js'
import {
  formatDefinitionResult,
  formatReferencesResult,
  formatHoverResult,
} from '../lsp/formatters.js'
import {
  renderToolUseMessage,
  renderToolResultMessage,
} from './lspToolUI.js'

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface LspToolInput {
  operation: 'goToDefinition' | 'findReferences' | 'hover'
  filePath: string
  line: number
  character: number
}

export interface LspToolOutput {
  type: 'lsp_result'
  operation: string
  result: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lspResult(operation: string, result: string) {
  return { data: { type: 'lsp_result' as const, operation, result } }
}

// ---------------------------------------------------------------------------
// Tool definition factory
// ---------------------------------------------------------------------------

export function lspToolDef(): ToolDef<LspToolInput, LspToolOutput> {
  return {
    name: 'LSP',
    shouldDefer: true,
    maxResultSizeChars: 50_000,

    get inputSchema() {
      return z.strictObject({
        operation: z.enum(['goToDefinition', 'findReferences', 'hover']),
        filePath: z.string(),
        line: semanticNumber(z.number().int().min(1)),
        character: semanticNumber(z.number().int().min(1)),
      })
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    isEnabled() {
      const server = getLspServer()
      return !server || server.isHealthy()
    },

    async prompt() {
      return (
        'Semantic code intelligence via Language Server Protocol. ' +
        'Provides goToDefinition (find where a symbol is defined), ' +
        'findReferences (find all usages of a symbol), and hover ' +
        '(get type/documentation info). Uses 1-based line and character ' +
        'positions (matching what editors display). ' +
        'Currently supports TypeScript/JavaScript files (.ts, .tsx, .js, .jsx). ' +
        'More precise than text search — finds symbols, not strings.'
      )
    },

    async description(input) {
      return `LSP ${input.operation} at ${input.filePath}:${input.line}:${input.character}`
    },

    userFacingName(input) {
      if (input.operation && input.filePath) {
        return `LSP(${input.operation} ${input.filePath}:${input.line ?? '?'}:${input.character ?? '?'})`
      }
      return 'LSP'
    },

    async call(input) {
      const resolvedPath = expandPath(input.filePath)

      if (!isSupportedExtension(resolvedPath)) {
        const ext = path.extname(resolvedPath) || '(no extension)'
        return lspResult(input.operation, `No LSP server available for file type: ${ext}`)
      }

      let server
      try {
        server = await ensureLspServer(resolvedPath)
      } catch (err) {
        const message = isNodeError(err) && err.code === 'ENOENT'
          ? 'typescript-language-server not found. Install it with: npm install -g typescript-language-server typescript'
          : `Failed to start LSP server: ${getErrorMessage(err)}`
        return lspResult(input.operation, message)
      }

      if (!server) {
        return lspResult(input.operation, `No LSP server available for file: ${input.filePath}`)
      }

      const fileUri = pathToFileURL(resolvedPath).href
      const position = { line: input.line - 1, character: input.character - 1 }
      const cwd = process.cwd()
      let resultText: string

      try {
        await server.ensureFileOpen(resolvedPath)
        switch (input.operation) {
          case 'goToDefinition': {
            const response = await server.sendRequest<
              Location | Location[] | LocationLink | LocationLink[] | null
            >('textDocument/definition', {
              textDocument: { uri: fileUri },
              position,
            })
            resultText = formatDefinitionResult(response, cwd)
            break
          }

          case 'findReferences': {
            const response = await server.sendRequest<Location[] | null>(
              'textDocument/references',
              {
                textDocument: { uri: fileUri },
                position,
                context: { includeDeclaration: true },
              },
            )
            resultText = formatReferencesResult(response, cwd)
            break
          }

          case 'hover': {
            const response = await server.sendRequest<Hover | null>(
              'textDocument/hover',
              {
                textDocument: { uri: fileUri },
                position,
              },
            )
            resultText = formatHoverResult(response, input.line, input.character)
            break
          }
        }
      } catch (err) {
        resultText =
          `LSP server error during ${input.operation}: ${getErrorMessage(err)}. ` +
          'The language server may still be indexing — try again in a moment.'
      }

      return lspResult(input.operation, resultText)
    },

    renderToolUseMessage,
    renderToolResultMessage,

    mapToolResultToToolResultBlockParam(
      output: LspToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: output.result,
      }
    },
  }
}
