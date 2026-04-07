import { stat } from 'node:fs/promises'
import { z } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { glob, relativizePaths } from '../utils/glob.js'
import { expandPath } from '../utils/expandPath.js'
import {
  renderToolUseMessage,
  renderToolResultMessage,
  isResultTruncated,
} from './globToolUI.js'

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface GlobToolInput {
  pattern: string
  path?: string
}

export interface GlobToolOutput {
  type: 'files'
  files: string[]
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Tool definition factory
// ---------------------------------------------------------------------------

export function globToolDef(): ToolDef<GlobToolInput, GlobToolOutput> {
  return {
    name: 'Glob',
    maxResultSizeChars: 100_000,

    get inputSchema() {
      return z.strictObject({
        pattern: z.string(),
        path: z.string().optional(),
      })
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'Fast file pattern matching tool that works with any codebase size. ' +
        'Supports glob patterns like "**/*.js" or "src/**/*.ts". ' +
        'Returns matching file paths sorted by modification time (most recent first).'
      )
    },

    async description(input) {
      const base = input.path ? ` in ${input.path}` : ''
      return `Glob ${input.pattern}${base}`
    },

    userFacingName(input) {
      return input.pattern ? `Glob(${input.pattern})` : 'Glob'
    },

    async validateInput(input, _context) {
      if (input.path) {
        const resolved = expandPath(input.path)
        try {
          const s = await stat(resolved)
          if (!s.isDirectory()) {
            return { result: false, message: `Path is not a directory: ${input.path}` }
          }
        } catch {
          return { result: false, message: `Path does not exist: ${input.path}` }
        }
      }
      return { result: true }
    },

    async call(input, context) {
      const cwd = input.path ? expandPath(input.path) : process.cwd()

      const result = await glob(
        input.pattern,
        cwd,
        { limit: 100, offset: 0 },
        context.abortController.signal,
      )

      return {
        data: {
          type: 'files' as const,
          files: result.files,
          truncated: result.truncated,
        },
      }
    },

    renderToolUseMessage,
    renderToolResultMessage,
    isResultTruncated,

    mapToolResultToToolResultBlockParam(
      output: GlobToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      if (output.files.length === 0) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: 'No files found',
        }
      }

      const cwd = process.cwd()
      const relativePaths = relativizePaths(output.files, cwd)
      let content = relativePaths.join('\n')

      if (output.truncated) {
        content += `\n\n(Results truncated. Showing first 100 files.)`
      }

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content,
      }
    },
  }
}
