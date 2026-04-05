import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Message, UserMessage, SystemMessage } from '../../types/message.js'
import type { QueryEvent, StreamEvent } from '../../types/streamEvents.js'
import type { ToolBatchEvent, ToolUseBlock } from '../tools/execution/types.js'

export type { Message, UserMessage, SystemMessage, QueryEvent, ContentBlockParam }

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
  systemPrompt: string
  abortSignal?: AbortSignal
}

/** Swap real implementations for test fakes. */
export interface QueryDeps {
  callModel: (params: CallModelParams) => AsyncGenerator<QueryEvent>
  executeToolBatch: (params: {
    toolUseBlocks: ToolUseInfo[]
    assistantMessageUUID: string
    abortSignal?: AbortSignal
  }) => AsyncGenerator<ToolBatchEvent>
  uuid: () => string
}

export interface AgentQueryParams {
  messages: Message[]
  systemPrompt: string
  maxTurns?: number
  abortSignal?: AbortSignal
  deps: QueryDeps
}

export type AgentEvent = StreamEvent | Message

export interface LoopState {
  messages: Message[]
  turnCount: number
}
