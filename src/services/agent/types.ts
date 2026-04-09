import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Message, UserMessage, SystemMessage } from '../../types/message.js'
import type { QueryEvent, StreamEvent } from '../../types/streamEvents.js'
import type { ProgressEvent, ToolBatchEvent, ToolUseBlock } from '../tools/execution/types.js'
import type { AutoCompactTrackingState, CompactionResult } from './auto-compact.js'
import type { EffortLevel } from './thinking.js'
import type { PermissionMode } from '../permissions/types.js'

export type { AutoCompactTrackingState, CompactionResult }

export type { Message, UserMessage, SystemMessage, QueryEvent, ContentBlockParam, ProgressEvent }
export type { EffortLevel }
export type { PermissionMode }

export type TerminalReason =
  | 'completed'
  | 'aborted'
  | 'model_error'
  | 'max_turns'

export interface Terminal {
  reason: TerminalReason
  error?: Error
  turnCount: number
}

/** Minimal shape of a tool_use content block from the model response. */
export type ToolUseInfo = ToolUseBlock

export interface CallModelParams {
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlockParam[] }>
  /**
   * System prompt sections, in order. The deps layer is responsible for
   * stripping the DYNAMIC_BOUNDARY marker and serializing to the API
   * format. See `services/system-prompt/` for how this array is built.
   */
  systemPrompt: string[]
  /**
   * Extended-thinking effort for this turn. The query loop derives this from
   * the most recent human user message via `detectEffortLevel`. The deps
   * layer turns it into the request's `thinking` field (or omits it for
   * `'off'`). See `services/agent/thinking.ts`.
   */
  effort?: EffortLevel
  abortSignal?: AbortSignal
}

/**
 * Auto-compact dependency: invoked at the top of each query-loop iteration
 * to decide whether the conversation needs summarization. Returns a result
 * (with the boundary marker + summary messages) if compaction ran, or
 * `null` if no compaction was needed. Optional — when omitted (e.g. in
 * legacy tests), the loop simply skips compaction.
 */
export interface AutoCompactParams {
  messages: Message[]
  systemPrompt: string[]
  tracking: AutoCompactTrackingState
  abortSignal?: AbortSignal
}

export interface AutoCompactOutcome {
  /** Present iff compaction ran. */
  compactionResult: CompactionResult | null
  /** Updated tracking state — caller should replace its state with this. */
  tracking: AutoCompactTrackingState
}

export type AutoCompactFn = (params: AutoCompactParams) => Promise<AutoCompactOutcome>

/** Swap real implementations for test fakes. */
export interface QueryDeps {
  callModel: (params: CallModelParams) => AsyncGenerator<QueryEvent>
  executeToolBatch: (params: {
    toolUseBlocks: ToolUseInfo[]
    assistantMessageUUID: string
    abortSignal?: AbortSignal
  }) => AsyncGenerator<ToolBatchEvent>
  uuid: () => string
  /**
   * Optional. When present, the query loop calls this once per iteration
   * before invoking `callModel`. If a compaction happens, the loop yields
   * the post-compact messages and replaces its in-memory message slice
   * with them for the next API call.
   */
  autoCompact?: AutoCompactFn
  /**
   * Optional. When present, the query loop calls this at the top of each
   * iteration — after the auto-compact check, before the next callModel —
   * to pick up any user messages that have been buffered since the turn
   * started (e.g. the REPL's command queue). Returned messages are yielded
   * as events AND pushed into the loop's in-memory message slice so the
   * next API call sees them. Returning `[]` means "nothing queued, carry on."
   *
   * This is the "between-iterations drain" path — the queue empties at the
   * next natural pause point inside a long multi-tool agent run, not only
   * when the whole run terminates.
   */
  drainQueuedInput?: () => Promise<Message[]>
  /**
   * Optional. Returns the current permission mode. Used by the query loop
   * to detect mid-turn mode changes (e.g. user toggles plan mode via
   * Shift+Tab) and inject a system-reminder message so the model learns
   * about the mode switch on the very next API call.
   */
  getPermissionMode?: () => PermissionMode
}

export interface AgentQueryParams {
  messages: Message[]
  /** System prompt sections — see `services/system-prompt/` for assembly. */
  systemPrompt: string[]
  maxTurns?: number
  abortSignal?: AbortSignal
  deps: QueryDeps
}

export type AgentEvent = StreamEvent | Message | ProgressEvent

export interface LoopState {
  messages: Message[]
  turnCount: number
  autoCompactTracking: AutoCompactTrackingState
  /** Tracks the permission mode from the previous iteration for mode-change detection. */
  previousMode?: PermissionMode
}
