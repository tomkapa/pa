import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { StructuredPatch } from 'diff'
import type { ToolDef, ToolResultBlockParam, PermissionResult } from '../services/tools/types.js'
import type { FileStateCache } from '../utils/fileStateCache.js'
import { checkProtectedPath } from '../services/permissions/safety.js'
import { expandPath, isUNCPath } from '../utils/expandPath.js'
import { checkStaleness, throwIfModifiedSinceRead, FILE_NOT_READ_ERROR } from '../utils/staleness.js'
import { generatePatch } from '../utils/diffPatch.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WriteToolInput {
  file_path: string
  content: string
}

export interface WriteToolOutput {
  type: 'create' | 'update'
  filePath: string
  content: string
  structuredPatch: StructuredPatch
  originalFile?: string
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function writeToolDef(
  fileStateCache: FileStateCache,
): ToolDef<WriteToolInput, WriteToolOutput> {
  return {
    name: 'Write',
    maxResultSizeChars: 10_000,

    get inputSchema() {
      return z.strictObject({
        file_path: z.string(),
        content: z.string(),
      })
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async checkPermissions(input): Promise<PermissionResult> {
      return checkProtectedPath(input.file_path, 'Write')
    },

    async prompt() {
      return (
        'Writes a file to the local filesystem. Creates parent directories if needed. ' +
        'Overwrites existing files (requires a prior Read). ' +
        'Returns a structured diff patch for display.'
      )
    },

    async description(input) {
      return `Write ${input.file_path}`
    },

    userFacingName(input) {
      return input.file_path ? `Write(${input.file_path})` : 'Write'
    },

    async validateInput(input, _context) {
      const filePath = expandPath(input.file_path)

      if (isUNCPath(input.file_path)) {
        return { result: false, message: 'UNC paths are not supported for security reasons.' }
      }

      let fileExists: boolean
      try {
        statSync(filePath)
        fileExists = true
      } catch {
        fileExists = false
      }

      if (!fileExists) {
        return { result: true }
      }

      const stalenessResult = checkStaleness(filePath, fileStateCache, true)
      if (stalenessResult.stale) {
        return { result: false, message: stalenessResult.message ?? FILE_NOT_READ_ERROR }
      }

      return { result: true }
    },

    async call(input, _context) {
      const filePath = expandPath(input.file_path)

      mkdirSync(dirname(filePath), { recursive: true })

      let originalFile: string | null = null
      let isNewFile: boolean

      try {
        originalFile = readFileSync(filePath, 'utf-8')
        isNewFile = false
      } catch {
        isNewFile = true
      }

      // --- CRITICAL SECTION: no await between staleness check and write ---
      if (!isNewFile) {
        throwIfModifiedSinceRead(filePath, originalFile!, fileStateCache)
      }

      writeFileSync(filePath, input.content, 'utf-8')
      // --- END CRITICAL SECTION ---

      const newMtime = statSync(filePath).mtimeMs
      fileStateCache.set(filePath, {
        content: input.content,
        timestamp: newMtime,
      })

      const type = isNewFile ? 'create' : 'update'
      const patchResult = isNewFile
        ? { patch: { oldFileName: '', newFileName: '', hunks: [], oldHeader: '', newHeader: '' } as StructuredPatch, linesAdded: 0, linesRemoved: 0 }
        : generatePatch(filePath, originalFile!, input.content)

      return {
        data: {
          type,
          filePath,
          content: input.content,
          structuredPatch: patchResult.patch,
          ...(originalFile !== null ? { originalFile } : {}),
        },
      }
    },

    mapToolResultToToolResultBlockParam(
      output: WriteToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      const message = output.type === 'create'
        ? `File created successfully at: ${output.filePath}`
        : `The file ${output.filePath} has been updated successfully.`

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: message,
      }
    },
  }
}
