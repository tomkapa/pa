import type { ToolResultBlockParam } from '../types.js'
import { MAX_RESULT_CHARS } from './types.js'

/**
 * Check if a tool_result content block is empty or effectively empty.
 */
export function isEmptyContent(
  content: ToolResultBlockParam['content'],
): boolean {
  if (content === undefined || content === null) return true
  if (typeof content === 'string') return content.trim().length === 0
  if (Array.isArray(content)) {
    if (content.length === 0) return true
    return content.every(block => {
      if (block.type === 'text') return block.text.trim().length === 0
      return false
    })
  }
  return false
}

/**
 * Compute the character length of a tool_result content block.
 */
export function contentSize(
  content: ToolResultBlockParam['content'],
): number {
  if (content === undefined || content === null) return 0
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    return content.reduce((sum, block) => {
      if (block.type === 'text') return sum + block.text.length
      // Non-text blocks (images) don't count toward char limit
      return sum
    }, 0)
  }
  return 0
}

/**
 * If the tool result exceeds the size threshold, truncate with a preview.
 *
 * The MVP does simple truncation. A future enhancement (CODE-51) adds
 * persist-to-disk, per-tool thresholds, and aggregate budgets.
 */
export function maybeTruncateLargeResult(
  block: ToolResultBlockParam,
  toolName: string,
  threshold = MAX_RESULT_CHARS,
): ToolResultBlockParam {
  const size = contentSize(block.content)
  if (size <= threshold) return block

  if (typeof block.content === 'string') {
    const previewLen = Math.min(2000, threshold)
    const preview = block.content.slice(0, previewLen)
    return {
      ...block,
      content: `Output too large (${size} chars, limit ${threshold}). Truncated.\n\nPreview:\n${preview}\n...`,
    }
  }

  // Array content: truncate text blocks
  if (Array.isArray(block.content)) {
    let remaining = threshold
    const truncated = block.content.map(b => {
      if (b.type === 'text' && remaining > 0) {
        const sliced = b.text.slice(0, remaining)
        remaining -= sliced.length
        return { ...b, text: sliced }
      }
      if (b.type === 'text') {
        return { ...b, text: '' }
      }
      return b
    })
    return {
      ...block,
      content: [
        ...truncated,
        {
          type: 'text' as const,
          text: `\n...\n(${toolName} output truncated: ${size} chars exceeded ${threshold} limit)`,
        },
      ],
    }
  }

  return block
}
