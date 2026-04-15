import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getProjectDir } from '../../session/paths.js'
import { getSessionId } from '../../observability/state.js'
import { isEmptyContent, contentSize } from './result-size.js'
import type { ToolResultBlockParam } from '../types.js'
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from './types.js'

const PREVIEW_SIZE_BYTES = 2000
const TOOL_RESULTS_SUBDIR = 'tool-results'

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getToolResultsDir(): string {
  return join(getProjectDir(process.cwd()), getSessionId(), TOOL_RESULTS_SUBDIR)
}

// ---------------------------------------------------------------------------
// Preview generation
// ---------------------------------------------------------------------------

/**
 * Truncate content at a newline boundary for the preview. If the first
 * `maxBytes` chars have no newline in the second half, fall back to a hard cut.
 */
export function generatePreview(
  content: string,
  maxBytes: number = PREVIEW_SIZE_BYTES,
): { preview: string; hasMore: boolean } {
  if (content.length <= maxBytes) return { preview: content, hasMore: false }
  const truncated = content.slice(0, maxBytes)
  const lastNewline = truncated.lastIndexOf('\n')
  // Use newline boundary if it's reasonably close (>50% of limit)
  const cutPoint = lastNewline > maxBytes * 0.5 ? lastNewline : maxBytes
  return { preview: content.slice(0, cutPoint), hasMore: true }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)}KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)}MB`
}

function buildPersistedOutputMessage(result: {
  filepath: string
  originalSize: number
  preview: string
  hasMore: boolean
}): string {
  const sizeStr = formatBytes(result.originalSize)
  const previewSection = result.hasMore
    ? `\n\nPreview (first ${formatBytes(PREVIEW_SIZE_BYTES)}):\n${result.preview}\n...`
    : `\n\n${result.preview}`
  return `<persisted-output>\nOutput too large (${sizeStr}). Full output saved to: ${result.filepath}${previewSection}\n</persisted-output>`
}

// ---------------------------------------------------------------------------
// Content guards
// ---------------------------------------------------------------------------

function hasImageBlock(content: ToolResultBlockParam['content']): boolean {
  if (!Array.isArray(content)) return false
  return content.some(
    block => block.type === 'image' || block.type === 'document',
  )
}

// ---------------------------------------------------------------------------
// Disk persistence
// ---------------------------------------------------------------------------

async function persistToolResult(
  content: NonNullable<ToolResultBlockParam['content']>,
  toolUseId: string,
): Promise<
  | { filepath: string; originalSize: number; preview: string; hasMore: boolean }
  | { error: string }
> {
  const isJson = Array.isArray(content)
  const contentStr = isJson ? JSON.stringify(content, null, 2) : content

  const dir = getToolResultsDir()
  await mkdir(dir, { recursive: true })

  const ext = isJson ? 'json' : 'txt'
  const filepath = join(dir, `${toolUseId}.${ext}`)
  try {
    await writeFile(filepath, contentStr, { flag: 'wx' })
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'EEXIST') {
      // Already written (e.g., message replay during compaction) — fall through
    } else {
      return { error: nodeErr.message }
    }
  }

  const { preview, hasMore } = generatePreview(contentStr, PREVIEW_SIZE_BYTES)
  return { filepath, originalSize: contentStr.length, preview, hasMore }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the effective threshold for a tool. A tool can declare a LOWER
 * threshold than the global default, but never a higher one — except
 * `Infinity` which opts out of persistence entirely.
 */
export function effectiveThreshold(toolMax: number): number {
  if (toolMax === Infinity) return Infinity
  return Math.min(toolMax, DEFAULT_MAX_RESULT_SIZE_CHARS)
}

/**
 * If the tool result exceeds the size threshold, persist to disk and return
 * a compact preview with a file path. The model can then use the Read tool
 * to access the full content on demand.
 *
 * Empty results get a marker so the model doesn't think the turn ended.
 * Image-containing results are never persisted (sent as-is).
 * Results under the threshold pass through unchanged (zero overhead).
 */
export async function maybePersistLargeToolResult(
  block: ToolResultBlockParam,
  toolName: string,
  threshold: number,
): Promise<ToolResultBlockParam> {
  const content = block.content

  // Guard: empty results get a marker
  if (isEmptyContent(content)) {
    return { ...block, content: `(${toolName} completed with no output)` }
  }

  // Guard: image/document blocks can't be persisted — send as-is
  if (hasImageBlock(content)) return block

  // Guard: under threshold — send as-is (fast path, no async work)
  const size = contentSize(content)
  if (size <= threshold) return block

  const result = await persistToolResult(
    content!,
    block.tool_use_id,
  )
  if ('error' in result) return block // Fallback: send original on failure

  return {
    ...block,
    content: buildPersistedOutputMessage(result),
  }
}
