import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Message, UserMessage } from '../../types/message.js'

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
