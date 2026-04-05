import type {
  Message,
  MessageDeltaUsage,
  RawMessageStreamEvent,
  Usage,
} from '@anthropic-ai/sdk/resources/messages/messages'

export interface StreamEvent {
  type: 'stream_event'
  event: RawMessageStreamEvent
  ttftMs?: number
}

export interface AssistantMessage {
  type: 'assistant'
  message: Message
  uuid: string
  timestamp: string
  requestId?: string
}

export type QueryEvent = StreamEvent | AssistantMessage

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }
}

type UsageLike = Partial<Usage> | MessageDeltaUsage

export function mergeUsage(base: TokenUsage, update: UsageLike): TokenUsage {
  const inputTokens = 'input_tokens' in update && update.input_tokens != null && update.input_tokens > 0
    ? update.input_tokens : base.inputTokens
  const outputTokens = 'output_tokens' in update && update.output_tokens != null && update.output_tokens > 0
    ? update.output_tokens : base.outputTokens
  const cacheCreationInputTokens = 'cache_creation_input_tokens' in update
    && update.cache_creation_input_tokens != null && update.cache_creation_input_tokens > 0
    ? update.cache_creation_input_tokens : base.cacheCreationInputTokens
  const cacheReadInputTokens = 'cache_read_input_tokens' in update
    && update.cache_read_input_tokens != null && update.cache_read_input_tokens > 0
    ? update.cache_read_input_tokens : base.cacheReadInputTokens

  return { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens }
}
