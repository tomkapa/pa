import { stat } from 'node:fs/promises'
import { relative, isAbsolute, resolve } from 'node:path'
import { z, type ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { ripGrep } from '../utils/ripgrep.js'
import { expandPath } from '../utils/expandPath.js'
import { semanticNumber, semanticBoolean } from '../utils/schema.js'
import { VCS_DIRS } from '../utils/vcs.js'
import {
  renderToolUseMessage,
  renderToolResultMessage,
  isResultTruncated,
} from './grepToolUI.js'

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count'

export interface GrepToolInput {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: GrepOutputMode
  '-B'?: number
  '-A'?: number
  '-C'?: number
  context?: number
  '-n'?: boolean
  '-i'?: boolean
  head_limit?: number
  offset?: number
  multiline?: boolean
}

export interface GrepToolOutput {
  type: 'grep_result'
  content: string
  mode: GrepOutputMode
  totalLines: number
  truncated: boolean
  appliedLimit: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HEAD_LIMIT = 250
const MAX_COLUMNS = 500
const CONTENT_LINE_RE = /^(.+?)(:\d+[:\-].*)$/

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildRgArgs(input: GrepToolInput): string[] {
  const mode = input.output_mode ?? 'files_with_matches'
  const args: string[] = []

  // Output mode flags
  switch (mode) {
    case 'files_with_matches':
      args.push('-l')
      break
    case 'count':
      args.push('-c')
      break
    case 'content': {
      // Line numbers default to true for content mode
      const showLineNumbers = input['-n'] !== false
      if (showLineNumbers) args.push('-n')

      // Context lines
      const contextBoth = input['-C'] ?? input.context
      if (contextBoth !== undefined) {
        args.push('-C', String(contextBoth))
      } else {
        if (input['-B'] !== undefined) args.push('-B', String(input['-B']))
        if (input['-A'] !== undefined) args.push('-A', String(input['-A']))
      }
      break
    }
  }

  // Case insensitive
  if (input['-i']) args.push('-i')

  // Multiline mode
  if (input.multiline) args.push('-U', '--multiline-dotall')

  // File type filter
  if (input.type) args.push('--type', input.type)

  // Glob file filter
  if (input.glob) args.push('--glob', input.glob)

  // Hardcoded safeguards
  args.push('--max-columns', String(MAX_COLUMNS))
  args.push('--hidden')

  // Exclude VCS directories
  for (const dir of VCS_DIRS) {
    args.push('--glob', `!${dir}`)
  }

  // Pattern — use -e if it starts with '-' to prevent misinterpretation
  if (input.pattern.startsWith('-')) {
    args.push('-e', input.pattern)
  } else {
    args.push(input.pattern)
  }

  // Explicit search path — ripgrep can hang without one
  args.push('.')

  return args
}

function applyPagination(
  lines: string[],
  headLimit: number,
  offset: number,
): { result: string[]; truncated: boolean } {
  // head_limit=0 means unlimited
  if (headLimit === 0) {
    const sliced = offset > 0 ? lines.slice(offset) : lines
    return { result: sliced, truncated: false }
  }

  const sliced = lines.slice(offset, offset + headLimit)
  const truncated = lines.length > offset + headLimit

  return { result: sliced, truncated }
}

function relativizePath(absPath: string, cwd: string): string {
  if (!isAbsolute(absPath)) return absPath
  return relative(cwd, absPath)
}

function relativizeContentLine(line: string, searchDir: string, projectCwd: string): string {
  const match = CONTENT_LINE_RE.exec(line)
  if (match?.[1] && match[2]) {
    const filePart = match[1]
    const rest = match[2]
    const absPath = isAbsolute(filePart) ? filePart : resolve(searchDir, filePart)
    return relativizePath(absPath, projectCwd) + rest
  }
  return line
}

// ---------------------------------------------------------------------------
// Tool definition factory
// ---------------------------------------------------------------------------

export function grepToolDef(): ToolDef<GrepToolInput, GrepToolOutput> {
  return {
    name: 'Grep',
    maxResultSizeChars: 20_000,

    get inputSchema(): ZodType<GrepToolInput> {
      // z.preprocess (used by semanticNumber/semanticBoolean) produces ZodEffects
      // whose _input type is unknown. The cast is safe — runtime validation is exact.
      return z.strictObject({
        pattern: z.string(),
        path: z.string().optional(),
        glob: z.string().optional(),
        type: z.string().optional(),
        output_mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
        '-B': semanticNumber(z.number().int().min(0).optional()),
        '-A': semanticNumber(z.number().int().min(0).optional()),
        '-C': semanticNumber(z.number().int().min(0).optional()),
        context: semanticNumber(z.number().int().min(0).optional()),
        '-n': semanticBoolean(z.boolean().optional()),
        '-i': semanticBoolean(z.boolean().optional()),
        head_limit: semanticNumber(z.number().int().min(0).optional()),
        offset: semanticNumber(z.number().int().min(0).optional()),
        multiline: semanticBoolean(z.boolean().optional()),
      }) as ZodType<GrepToolInput>
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'Search tool built on ripgrep for searching file contents with regex. ' +
        'Supports full regex syntax, file type filtering, context lines, and multiple output modes. ' +
        'Output modes: "files_with_matches" (default, shows file paths), "content" (shows matching lines), "count" (shows match counts). ' +
        'Results are paginated with head_limit (default 250) and offset.'
      )
    },

    async description(input) {
      const mode = input.output_mode ?? 'files_with_matches'
      const path = input.path ? ` in ${input.path}` : ''
      const fileFilter = input.glob ? ` (${input.glob})` : input.type ? ` (type:${input.type})` : ''
      return `Grep "${input.pattern}"${path}${fileFilter} [${mode}]`
    },

    userFacingName(input) {
      return input.pattern ? `Grep(${input.pattern})` : 'Grep'
    },

    async validateInput(input, _context) {
      if (input.path) {
        const resolved = expandPath(input.path)
        try {
          const s = await stat(resolved)
          if (!s.isDirectory() && !s.isFile()) {
            return { result: false, message: `Path is not a file or directory: ${input.path}` }
          }
        } catch {
          return { result: false, message: `Path does not exist: ${input.path}` }
        }
      }
      return { result: true }
    },

    async call(input, context) {
      const mode = input.output_mode ?? 'files_with_matches'
      const headLimit = input.head_limit ?? DEFAULT_HEAD_LIMIT
      const offset = input.offset ?? 0
      const projectCwd = process.cwd()
      const searchDir = input.path ? expandPath(input.path) : projectCwd

      const args = buildRgArgs(input)
      const rawLines = await ripGrep(args, searchDir, context.abortController.signal)

      // Paginate first, then relativize — avoids processing lines we'll discard
      const totalLines = rawLines.length
      const { result: paginatedRaw, truncated } = applyPagination(rawLines, headLimit, offset)

      const toAbs = (p: string) => isAbsolute(p) ? p : resolve(searchDir, p)

      let processedLines: string[]
      switch (mode) {
        case 'files_with_matches':
          processedLines = paginatedRaw.map(line => relativizePath(toAbs(line), projectCwd))
          break
        case 'content':
          processedLines = paginatedRaw.map(line => relativizeContentLine(line, searchDir, projectCwd))
          break
        case 'count':
          processedLines = paginatedRaw.map(line => {
            const sepIdx = line.lastIndexOf(':')
            if (sepIdx > 0) {
              const filePart = line.slice(0, sepIdx)
              const countPart = line.slice(sepIdx)
              return relativizePath(toAbs(filePart), projectCwd) + countPart
            }
            return line
          })
          break
      }

      const content = processedLines.join('\n')

      return {
        data: {
          type: 'grep_result' as const,
          content,
          mode,
          totalLines,
          truncated,
          appliedLimit: headLimit,
        },
      }
    },

    renderToolUseMessage,
    renderToolResultMessage,
    isResultTruncated,

    mapToolResultToToolResultBlockParam(
      output: GrepToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      if (!output.content) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: 'No matches found',
        }
      }

      let content = output.content

      if (output.truncated) {
        content += `\n\n(Results truncated. Showing ${output.appliedLimit} entries starting at offset. Total: ${output.totalLines}. Use offset to paginate.)`
      }

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content,
      }
    },
  }
}
