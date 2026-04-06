import { readFileSync, statSync } from 'node:fs'
import type { FileStateCache } from './fileStateCache.js'
import { stripLineNumbers } from './file.js'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been modified since it was last read. Read the file again before editing.'

export const FILE_NOT_READ_ERROR =
  'File has not been read yet. Read the file before writing to it.'

export interface StalenessCheckResult {
  stale: boolean
  message?: string
}

/**
 * Verify a file has been read and hasn't been modified since.
 *
 * For full reads (no offset/limit), uses a content-comparison fallback
 * to handle false-positive mtime changes (e.g. cloud sync, antivirus).
 *
 * @param requireFullRead - If true, rejects partial reads (for Write tool)
 */
export function checkStaleness(
  filePath: string,
  cache: FileStateCache,
  requireFullRead: boolean,
): StalenessCheckResult {
  const cached = cache.get(filePath)

  if (!cached) {
    return { stale: true, message: FILE_NOT_READ_ERROR }
  }

  if (cached.isPartialView) {
    return { stale: true, message: FILE_NOT_READ_ERROR }
  }

  if (requireFullRead && (cached.offset !== undefined || cached.limit !== undefined)) {
    return { stale: true, message: FILE_NOT_READ_ERROR }
  }

  let currentMtime: number
  try {
    currentMtime = statSync(filePath).mtimeMs
  } catch {
    return { stale: true, message: FILE_UNEXPECTEDLY_MODIFIED_ERROR }
  }

  if (currentMtime > cached.timestamp) {
    if (!cached.offset && !cached.limit) {
      try {
        const currentContent = readFileSync(filePath, 'utf-8')
        const normalizedCurrent = currentContent.replace(/\r\n/g, '\n')
        const cachedRaw = stripLineNumbers(cached.content)
        if (normalizedCurrent === cachedRaw) {
          return { stale: false }
        }
      } catch {
        // Can't read — treat as stale
      }
    }
    return { stale: true, message: FILE_UNEXPECTEDLY_MODIFIED_ERROR }
  }

  return { stale: false }
}

/**
 * Synchronous staleness guard for use inside critical sections.
 * Uses the already-read file content to avoid a redundant read.
 * Throws if the file was modified since the last read.
 */
export function throwIfModifiedSinceRead(
  filePath: string,
  currentContent: string,
  cache: FileStateCache,
): void {
  const currentMtime = statSync(filePath).mtimeMs
  const cached = cache.get(filePath)
  if (!cached || currentMtime <= cached.timestamp) return

  // Content-comparison fallback for false-positive mtime changes
  const normalizedCurrent = currentContent.replace(/\r\n/g, '\n')
  const cachedRaw = stripLineNumbers(cached.content)
  if (normalizedCurrent !== cachedRaw) {
    throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
  }
}
