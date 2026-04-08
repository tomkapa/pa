import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Message, UserMessage } from '../../types/message.js'
import { COMPACT_BOUNDARY_SUBTYPE } from '../../types/message.js'

/**
 * Returns true if the message is a genuine human turn — actual user input,
 * not a system-injected meta message or a tool_result.
 *
 * This is the single most important predicate in the codebase.
 * - `isMeta` catches system-injected user messages (attachments, hooks)
 * - `toolUseResult` catches tool_result blocks (API requires type: 'user' for these)
 * Both checks are needed.
 */
export function isHumanTurn(m: Message): m is UserMessage {
  return m.type === 'user' && !m.isMeta && m.toolUseResult === undefined
}

/**
 * Returns true if the message should be included in API calls.
 * - user and assistant messages: always included
 * - system messages: only `local_command` subtype (converted to user message during normalization)
 */
export function isApiMessage(m: Message): boolean {
  if (m.type === 'user' || m.type === 'assistant') return true
  if (m.type === 'system' && m.subtype === 'local_command') return true
  return false
}

/** Type guard for `tool_result` content blocks inside a user message. */
export function isToolResultBlock(block: unknown): block is ToolResultBlockParam {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    (block as { type: unknown }).type === 'tool_result'
  )
}

/** Returns true if the message is a compact boundary marker. */
export function isCompactBoundary(m: Message): boolean {
  return m.type === 'system' && m.subtype === COMPACT_BOUNDARY_SUBTYPE
}

/**
 * Returns the slice of messages starting *after* the most recent compact
 * boundary marker. The boundary marker itself is excluded — its only purpose
 * is to fence off pre-compact history from API serialization. Messages
 * pushed after a compaction (the summary user message, attachments, the
 * model's continuation) are what the model should see.
 *
 * If no boundary exists, returns the input unchanged.
 */
export function getMessagesAfterCompactBoundary(messages: Message[]): Message[] {
  let lastBoundaryIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactBoundary(messages[i]!)) {
      lastBoundaryIndex = i
      break
    }
  }
  if (lastBoundaryIndex === -1) return messages
  return messages.slice(lastBoundaryIndex + 1)
}
