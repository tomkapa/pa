import type { ToolResultBlockParam } from '../types.js'

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
