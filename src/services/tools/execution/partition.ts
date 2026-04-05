import type { Tool } from '../types.js'
import { findToolByName } from '../registry.js'
import type { Batch, ToolUseBlock } from './types.js'

/**
 * Partition tool_use blocks into execution batches.
 *
 * Consecutive concurrency-safe tools form a single concurrent batch.
 * Each non-safe tool becomes its own serial batch.
 *
 * Example: [Read, Read, Grep, Edit, Read, Read]
 *           ─────────────────  ────  ──────────
 *            concurrent batch  serial concurrent batch
 */
export function partitionIntoBatches(
  blocks: ToolUseBlock[],
  tools: Tool<unknown, unknown>[],
): Batch[] {
  if (blocks.length === 0) return []

  const batches: Batch[] = []
  let currentConcurrent: ToolUseBlock[] = []

  for (const block of blocks) {
    const tool = findToolByName(tools, block.name)
    // Fail-closed: unknown tools are treated as not concurrency-safe
    const isSafe = tool ? tool.isConcurrencySafe(block.input) : false

    if (isSafe) {
      currentConcurrent.push(block)
    } else {
      if (currentConcurrent.length > 0) {
        batches.push({ type: 'concurrent', blocks: currentConcurrent })
        currentConcurrent = []
      }
      batches.push({ type: 'serial', blocks: [block] })
    }
  }

  if (currentConcurrent.length > 0) {
    batches.push({ type: 'concurrent', blocks: currentConcurrent })
  }

  return batches
}
