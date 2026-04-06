import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { z } from 'zod'
import type { StructuredPatch } from 'diff'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import type { FileStateCache } from '../utils/fileStateCache.js'
import { expandPath, isUNCPath } from '../utils/expandPath.js'
import { checkStaleness, throwIfModifiedSinceRead, FILE_NOT_READ_ERROR } from '../utils/staleness.js'
import { generatePatch } from '../utils/diffPatch.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONE_GIB = 1024 * 1024 * 1024

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditToolInput {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export interface EditToolOutput {
  filePath: string
  oldString: string
  newString: string
  originalFile?: string
  structuredPatch: StructuredPatch
  replaceAll: boolean
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function editToolDef(
  fileStateCache: FileStateCache,
): ToolDef<EditToolInput, EditToolOutput> {
  return {
    name: 'Edit',
    maxResultSizeChars: 10_000,

    get inputSchema() {
      return z.strictObject({
        file_path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().default(false),
      })
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async prompt() {
      return (
        'Performs exact string replacement in a file. ' +
        'The old_string must be unique in the file unless replace_all is true. ' +
        'Requires a prior Read of the file. Returns a structured diff patch.'
      )
    },

    async description(input) {
      return `Edit ${input.file_path}`
    },

    userFacingName(input) {
      return input.file_path ? `Edit(${input.file_path})` : 'Edit'
    },

    async validateInput(input, _context) {
      const filePath = expandPath(input.file_path)

      if (input.old_string === input.new_string) {
        return { result: false, message: 'old_string and new_string are the same. No changes needed.' }
      }

      if (isUNCPath(input.file_path)) {
        return { result: false, message: 'UNC paths are not supported for security reasons.' }
      }

      if (extname(filePath).toLowerCase() === '.ipynb') {
        return { result: false, message: 'Cannot edit Jupyter notebook files (.ipynb). Use the NotebookEdit tool instead.' }
      }

      let fileExists: boolean
      let fileSize = 0
      try {
        const fileStat = statSync(filePath)
        fileExists = true
        fileSize = fileStat.size
      } catch {
        fileExists = false
      }

      if (!fileExists) {
        if (input.old_string === '') {
          return { result: true }
        }
        return {
          result: false,
          message: `File not found: ${filePath}. Check the path and try again.`,
        }
      }

      if (fileSize > ONE_GIB) {
        return { result: false, message: `File is too large (${fileSize} bytes). Maximum supported size is 1 GiB.` }
      }

      const rawContent = readFileSync(filePath, 'utf-8')
      const content = rawContent.replace(/\r\n/g, '\n')

      if (input.old_string === '' && content.length > 0) {
        return {
          result: false,
          message: 'Cannot use empty old_string on a non-empty file. This would prepend text. Provide the specific text to replace.',
        }
      }

      const stalenessResult = checkStaleness(filePath, fileStateCache, false)
      if (stalenessResult.stale) {
        return { result: false, message: stalenessResult.message ?? FILE_NOT_READ_ERROR }
      }

      if (input.old_string !== '') {
        const matchCount = countOccurrences(content, input.old_string)

        if (matchCount === 0) {
          return { result: false, message: 'String to replace not found in the file.' }
        }

        if (matchCount > 1 && !input.replace_all) {
          return {
            result: false,
            message: `Found ${matchCount} matches for the search string. Set replace_all to true or provide more surrounding context to make the match unique.`,
          }
        }
      }

      return { result: true }
    },

    async call(input, _context) {
      const filePath = expandPath(input.file_path)

      mkdirSync(dirname(filePath), { recursive: true })

      let rawBuffer: Buffer
      let isNewFile: boolean
      try {
        rawBuffer = readFileSync(filePath)
        isNewFile = false
      } catch {
        rawBuffer = Buffer.alloc(0)
        isNewFile = true
      }

      const encoding = detectEncoding(rawBuffer)
      const rawContent = rawBuffer.toString(encoding)
      const originalLineEnding = detectLineEnding(rawContent)
      const originalFile = rawContent

      // Normalize to LF for replacement
      const normalizedContent = rawContent.replace(/\r\n/g, '\n')

      // --- CRITICAL SECTION: no await between staleness check and write ---
      if (!isNewFile) {
        throwIfModifiedSinceRead(filePath, rawContent, fileStateCache)
      }

      let newContent: string
      if (input.replace_all) {
        newContent = normalizedContent.replaceAll(input.old_string, input.new_string)
      } else {
        newContent = normalizedContent.replace(input.old_string, input.new_string)
      }

      // Deletion cleanup: strip trailing newline after deleted text to prevent orphaned blank lines
      if (
        input.new_string === '' &&
        !input.old_string.endsWith('\n') &&
        !input.replace_all
      ) {
        const oldIdx = normalizedContent.indexOf(input.old_string)
        if (oldIdx !== -1) {
          const afterOld = oldIdx + input.old_string.length
          if (afterOld < normalizedContent.length && normalizedContent[afterOld] === '\n') {
            newContent =
              normalizedContent.slice(0, oldIdx) +
              normalizedContent.slice(afterOld + 1)
          }
        }
      }

      const outputContent = originalLineEnding === '\r\n'
        ? newContent.replace(/\n/g, '\r\n')
        : newContent

      writeFileSync(filePath, outputContent, 'utf-8')
      // --- END CRITICAL SECTION ---

      const newMtime = statSync(filePath).mtimeMs
      fileStateCache.set(filePath, {
        content: outputContent,
        timestamp: newMtime,
      })

      const patchResult = generatePatch(filePath, normalizedContent, newContent)

      return {
        data: {
          filePath,
          oldString: input.old_string,
          newString: input.new_string,
          ...(originalFile ? { originalFile } : {}),
          structuredPatch: patchResult.patch,
          replaceAll: input.replace_all ?? false,
        },
      }
    },

    mapToolResultToToolResultBlockParam(
      output: EditToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `The file ${output.filePath} has been edited successfully.`,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countOccurrences(text: string, search: string): number {
  if (search === '') return 0
  let count = 0
  let idx = 0
  while ((idx = text.indexOf(search, idx)) !== -1) {
    count++
    idx += search.length
  }
  return count
}

function detectEncoding(buffer: Buffer): BufferEncoding {
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return 'utf16le'
  }
  return 'utf-8'
}

function detectLineEnding(content: string): string {
  const sample = content.slice(0, 4096)
  const crlfCount = (sample.match(/\r\n/g) ?? []).length
  const lfCount = (sample.match(/(?<!\r)\n/g) ?? []).length

  return crlfCount > lfCount ? '\r\n' : '\n'
}
