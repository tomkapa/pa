import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Message, UserMessage, SystemMessage } from '../../types/message.js'
import type { QueryEvent, StreamEvent } from '../../types/streamEvents.js'

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

export interface ToolResult {
  toolUseId: string
  content: string
  isError: boolean
}

/** Minimal shape of a tool_use content block from the model response. */
export interface ToolUseInfo {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

/** Shared context carried across tool executions within a session. */
export interface ToolUseContext {
  [key: string]: unknown
}

export interface CallModelParams {
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlockParam[] }>
  systemPrompt: string
  abortSignal?: AbortSignal
}

/** Swap real implementations for test fakes. */
export interface QueryDeps {
  callModel: (params: CallModelParams) => AsyncGenerator<QueryEvent>
  executeTool: (toolUse: ToolUseInfo, context: ToolUseContext) => Promise<ToolResult>
  uuid: () => string
}

export interface AgentQueryParams {
  messages: Message[]
  systemPrompt: string
  maxTurns?: number
  abortSignal?: AbortSignal
  toolUseContext?: ToolUseContext
  deps: QueryDeps
}

export type AgentEvent = StreamEvent | Message

export interface LoopState {
  messages: Message[]
  toolUseContext: ToolUseContext
  turnCount: number
}
