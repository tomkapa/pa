import { readFile as fsReadFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { FileStateCache } from '../utils/fileStateCache.js'
import { formatFileContentWithLineNumbers } from '../utils/file.js'
import { isBinaryExtension, isBinaryContent, isDeviceFile } from '../utils/binaryDetection.js'

export interface ReadToolInput {
  file_path: string
  offset?: number
  limit?: number
}

export interface ReadToolOutput {
  type: 'text'
  content: string
  numLines: number
  startLine: number
  totalLines: number
}

export const ReadErrorCode = {
  FILE_NOT_FOUND: 2,
  BINARY_FILE: 4,
  DEVICE_FILE: 9,
} as const

export class ReadToolError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message)
    this.name = 'ReadToolError'
  }
}

export function readToolDef(
  fileStateCache: FileStateCache,
): ToolDef<ReadToolInput, ReadToolOutput> {
  return {
    name: 'Read',
    maxResultSizeChars: 100_000,

    get inputSchema() {
      return z.strictObject({
        file_path: z.string(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).optional(),
      })
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'Reads a file from the local filesystem. Returns content with line numbers ' +
        '(cat -n format). Use offset and limit for partial reads.'
      )
    },

    async description(input) {
      return `Read ${input.file_path}${input.offset ? ` from line ${input.offset}` : ''}${input.limit ? ` (${input.limit} lines)` : ''}`
    },

    userFacingName(input) {
      return input.file_path ? `Read(${input.file_path})` : 'Read'
    },

    async call(input, _context) {
      const filePath = resolveFilePath(input.file_path)

      if (isDeviceFile(filePath)) {
        throw new ReadToolError(`Cannot read device file: ${filePath}`, ReadErrorCode.DEVICE_FILE)
      }

      const ext = extname(filePath).toLowerCase()
      if (ext && isBinaryExtension(ext)) {
        throw new ReadToolError(`Cannot read binary file (${ext}): ${filePath}`, ReadErrorCode.BINARY_FILE)
      }

      // Read as buffer first to check for binary content before decoding
      let rawBuffer: Buffer
      let mtime: number
      try {
        const [buffer, fileStat] = await Promise.all([
          fsReadFile(filePath),
          stat(filePath),
        ])
        rawBuffer = buffer
        mtime = fileStat.mtimeMs
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new ReadToolError(`File not found: ${filePath}`, ReadErrorCode.FILE_NOT_FOUND)
        }
        throw err
      }

      if (isBinaryContent(rawBuffer.subarray(0, 8192))) {
        throw new ReadToolError(`Cannot read binary file (detected by content): ${filePath}`, ReadErrorCode.BINARY_FILE)
      }

      const rawContent = rawBuffer.toString('utf-8')

      if (rawContent === '') {
        fileStateCache.set(filePath, {
          content: '',
          timestamp: mtime,
          offset: input.offset,
          limit: input.limit,
        })
        return {
          data: { type: 'text' as const, content: '', numLines: 0, startLine: input.offset ?? 1, totalLines: 0 },
        }
      }

      const allLines = rawContent.split('\n')
      if (allLines[allLines.length - 1] === '') {
        allLines.pop()
      }
      const totalLines = allLines.length

      const offset = input.offset ?? 1
      const startIndex = offset - 1
      const slicedLines = startIndex >= totalLines
        ? []
        : input.limit !== undefined
          ? allLines.slice(startIndex, startIndex + input.limit)
          : allLines.slice(startIndex)

      const formatted = formatFileContentWithLineNumbers(slicedLines.join('\n'), offset)

      fileStateCache.set(filePath, {
        content: formatted,
        timestamp: mtime,
        offset: input.offset,
        limit: input.limit,
      })

      return {
        data: {
          type: 'text' as const,
          content: formatted,
          numLines: slicedLines.length,
          startLine: offset,
          totalLines,
        },
      }
    },

    mapToolResultToToolResultBlockParam(
      output: ReadToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: output.content || '(empty file)',
      }
    },
  }
}

function resolveFilePath(filePath: string): string {
  if (filePath === '~' || filePath.startsWith('~/')) {
    return resolve(homedir(), filePath.slice(2))
  }
  if (!isAbsolute(filePath)) {
    return resolve(process.cwd(), filePath)
  }
  return resolve(filePath)
}
