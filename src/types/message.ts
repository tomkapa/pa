import type {
  ContentBlock,
  ContentBlockParam,
  Message as ApiMessage,
} from '@anthropic-ai/sdk/resources/messages/messages'

// Re-export SDK types that consumers of message types will need
export type { ContentBlock, ContentBlockParam, ApiMessage }

/**
 * Discriminated union of all message types in the conversation.
 * Tagged by the `type` field for exhaustive narrowing.
 *
 * The conversation is a flat `Message[]` — this maps directly to the
 * Claude Messages API's alternating user/assistant structure.
 */
export type Message = UserMessage | AssistantMessage | SystemMessage

// ---------------------------------------------------------------------------
// Common fields shared by every message variant
// ---------------------------------------------------------------------------

interface MessageBase {
  uuid: string       // crypto.randomUUID() — identity for tracking, rewind, dedup
  timestamp: string  // ISO-8601 — display ordering and session replay
}

// ---------------------------------------------------------------------------
// UserMessage
// ---------------------------------------------------------------------------

export interface UserMessage extends MessageBase {
  type: 'user'
  message: {
    role: 'user'
    content: string | ContentBlockParam[]
  }
  /** System-injected user message (tool results, attachments, hooks). Not a human turn. */
  isMeta?: true
  /** Present when this is a tool_result message. */
  toolUseResult?: unknown
  /** Name of the tool that produced this result. */
  toolName?: string
  /** Links tool_result to its tool_use's assistant message UUID. */
  sourceToolAssistantUUID?: string
}

// ---------------------------------------------------------------------------
// AssistantMessage
// ---------------------------------------------------------------------------

export interface AssistantMessage extends MessageBase {
  type: 'assistant'
  /** Raw Anthropic API response — preserves full shape (usage, model, stop_reason). */
  message: ApiMessage
  /** API request ID for debugging / support. */
  requestId: string | undefined
}

// ---------------------------------------------------------------------------
// SystemMessage (UI-only, never sent to API — except local_command subtype)
// ---------------------------------------------------------------------------

export interface SystemMessage extends MessageBase {
  type: 'system'
  /** Discriminant for further narrowing system message subtypes. */
  subtype: string
  content: string
  level: 'info' | 'warning' | 'error'
}
