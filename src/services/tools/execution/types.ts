import type { Tool, ToolUseContext } from '../types.js'
import type { PermissionDecision } from '../../permissions/types.js'
import type { UserMessage, AssistantMessage, Message } from '../../../types/message.js'

// ---------------------------------------------------------------------------
// Tool use block — minimal shape from model response
// ---------------------------------------------------------------------------

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

// ---------------------------------------------------------------------------
// Permission check function — caller-provided permission logic
//
// Returns PermissionDecision (always resolved — no passthrough).
// ---------------------------------------------------------------------------

export type CanUseToolFn = (
  tool: Tool<unknown, unknown>,
  input: unknown,
  context: ToolUseContext,
) => Promise<PermissionDecision>

// ---------------------------------------------------------------------------
// Context modifier — deferred context mutation from tool results
// ---------------------------------------------------------------------------

export interface ContextModifier {
  toolUseID: string
  modifyContext: (context: ToolUseContext) => ToolUseContext
}

// ---------------------------------------------------------------------------
// Batch — a group of tool_use blocks to execute together
// ---------------------------------------------------------------------------

export interface Batch {
  type: 'concurrent' | 'serial'
  blocks: ToolUseBlock[]
}

// ---------------------------------------------------------------------------
// Events yielded by the execution engine
// ---------------------------------------------------------------------------

export type ToolExecutionEvent =
  | {
      type: 'tool_result'
      message: UserMessage
      contextModifiers: ContextModifier[]
      newMessages?: Message[]
    }
  | {
      type: 'progress'
      toolUseId: string
      toolName: string
      content: string
    }

export type RunToolsEvent =
  | ToolExecutionEvent
  | { type: 'context_update'; context: ToolUseContext }

// ---------------------------------------------------------------------------
// Events yielded to the agent loop (simplified interface)
// ---------------------------------------------------------------------------

export type ToolBatchEvent =
  | { type: 'tool_result'; message: UserMessage }
  | { type: 'progress'; toolUseId: string; toolName: string; content: string }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_CONCURRENCY_CAP = 10
export const MAX_RESULT_CHARS = 50_000
