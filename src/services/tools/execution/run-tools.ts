import type { ToolUseContext } from '../types.js'
import type { AssistantMessage } from '../../../types/message.js'
import { partitionIntoBatches } from './partition.js'
import { runToolUse } from './run-tool-use.js'
import { all } from './all.js'
import type {
  ToolUseBlock,
  CanUseToolFn,
  ContextModifier,
  RunToolsEvent,
} from './types.js'
import { DEFAULT_CONCURRENCY_CAP } from './types.js'

/**
 * Orchestrate execution of tool_use blocks from a model response.
 *
 * Partitions blocks into batches:
 * - Consecutive concurrency-safe tools → concurrent batch (parallel up to cap)
 * - Each non-safe tool → serial batch (runs alone)
 *
 * Batches execute in sequence. Context modifiers from concurrent batches
 * are queued and applied in arrival order after the batch completes.
 * Serial batch modifiers apply immediately.
 */
export async function* runTools(
  toolUseBlocks: ToolUseBlock[],
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  context: ToolUseContext,
  concurrencyCap = DEFAULT_CONCURRENCY_CAP,
): AsyncGenerator<RunToolsEvent> {
  if (toolUseBlocks.length === 0) return

  const tools = context.options.tools
  const batches = partitionIntoBatches(toolUseBlocks, tools)
  let currentContext = context

  for (const batch of batches) {
    if (batch.type === 'concurrent' && batch.blocks.length > 1) {
      for await (const event of executeConcurrentBatch(
        batch.blocks, tools, canUseTool, currentContext,
        assistantMessage.uuid, concurrencyCap,
      )) {
        if (event.type === 'context_update') {
          currentContext = event.context
        }
        yield event
      }
    } else {
      for (const block of batch.blocks) {
        for await (const event of executeSerialBlock(
          block, tools, canUseTool, currentContext,
          assistantMessage.uuid,
        )) {
          if (event.type === 'context_update') {
            currentContext = event.context
          }
          yield event
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function* executeConcurrentBatch(
  blocks: ToolUseBlock[],
  tools: ToolUseContext['options']['tools'],
  canUseTool: CanUseToolFn,
  context: ToolUseContext,
  assistantMessageUUID: string,
  concurrencyCap: number,
): AsyncGenerator<RunToolsEvent> {
  const generators = blocks.map(block =>
    runToolUse(block, tools, canUseTool, context, assistantMessageUUID),
  )

  const pendingModifiers: ContextModifier[] = []

  for await (const event of all(generators, concurrencyCap)) {
    if (event.type === 'tool_result') {
      for (const mod of event.contextModifiers) {
        pendingModifiers.push(mod)
      }
    }
    yield event
  }

  if (pendingModifiers.length > 0) {
    let updatedContext = context
    for (const mod of pendingModifiers) {
      updatedContext = mod.modifyContext(updatedContext)
    }
    yield { type: 'context_update', context: updatedContext }
  }
}

async function* executeSerialBlock(
  block: ToolUseBlock,
  tools: ToolUseContext['options']['tools'],
  canUseTool: CanUseToolFn,
  context: ToolUseContext,
  assistantMessageUUID: string,
): AsyncGenerator<RunToolsEvent> {
  for await (const event of runToolUse(block, tools, canUseTool, context, assistantMessageUUID)) {
    yield event
    if (event.type === 'tool_result' && event.contextModifiers.length > 0) {
      let updatedContext = context
      for (const mod of event.contextModifiers) {
        updatedContext = mod.modifyContext(updatedContext)
      }
      yield { type: 'context_update', context: updatedContext }
    }
  }
}
