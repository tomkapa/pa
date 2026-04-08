import type {
  ContentBlock,
  ContentBlockParam,
  Message,
  UserMessage,
  AssistantMessage,
  SystemMessage,
} from '../../types/message.js'
import { isApiMessage } from './predicates.js'
import { toContentBlocks } from './factory.js'

type ApiMessageOutput = UserMessage | AssistantMessage

/**
 * Normalizes internal message state into what the Claude Messages API accepts.
 *
 * 1. Filters out non-API types (system messages, except local_command)
 * 2. Converts local_command system messages to user messages
 * 3. Merges consecutive user messages (API requires strict user/assistant alternation)
 */
export function normalizeMessagesForAPI(messages: Message[]): ApiMessageOutput[] {
  const apiMessages = messages
    .filter(isApiMessage)
    .map(convertToApiType)

  return mergeConsecutiveUserMessages(apiMessages)
}

function convertToApiType(m: Message): ApiMessageOutput {
  if (m.type === 'system' && m.subtype === 'local_command') {
    return systemToUserMessage(m)
  }
  if (m.type === 'assistant') {
    return ensureThinkingFirst(m)
  }
  return m as ApiMessageOutput
}

/**
 * The Anthropic Messages API requires that any `thinking` (or
 * `redacted_thinking`) blocks in an assistant message appear *before* any
 * `text` / `tool_use` blocks. The streaming layer normally preserves
 * model-declared order, but a single misordered turn permanently breaks
 * the next request — so we enforce the invariant once at the API
 * boundary as a belt-and-suspenders guard.
 *
 * Object identity is preserved when no reordering is needed, so the
 * common-case turn (no thinking, or already-correct order) is a no-op.
 */
export function sortAssistantContent(content: readonly ContentBlock[]): ContentBlock[] {
  let firstNonThinking = -1
  for (let i = 0; i < content.length; i++) {
    const t = content[i]!.type
    if (t === 'thinking' || t === 'redacted_thinking') {
      if (firstNonThinking !== -1) {
        // Found a thinking block *after* a non-thinking block — sort needed.
        const thinking: ContentBlock[] = []
        const rest: ContentBlock[] = []
        for (const b of content) {
          if (b.type === 'thinking' || b.type === 'redacted_thinking') thinking.push(b)
          else rest.push(b)
        }
        return [...thinking, ...rest]
      }
    } else if (firstNonThinking === -1) {
      firstNonThinking = i
    }
  }
  return content as ContentBlock[]
}

function ensureThinkingFirst(m: AssistantMessage): AssistantMessage {
  const sorted = sortAssistantContent(m.message.content)
  if (sorted === m.message.content) return m
  return {
    ...m,
    message: { ...m.message, content: sorted },
  }
}

function systemToUserMessage(m: SystemMessage): UserMessage {
  return {
    type: 'user',
    uuid: m.uuid,
    timestamp: m.timestamp,
    message: {
      role: 'user',
      content: [{ type: 'text', text: m.content }],
    },
    isMeta: true,
  }
}

/**
 * Normalize messages and project them onto the `{role, content}` shape the
 * Anthropic SDK accepts. Used by the query loop and the compaction
 * summarizer — anywhere internal `Message` history needs to become the API
 * payload.
 */
export interface ApiMessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}

export function toApiMessageParams(messages: Message[]): ApiMessageParam[] {
  return normalizeMessagesForAPI(messages).map(m => ({
    role: m.message.role,
    content: m.message.content,
  }))
}

function mergeConsecutiveUserMessages(messages: ApiMessageOutput[]): ApiMessageOutput[] {
  const result: ApiMessageOutput[] = []

  for (const msg of messages) {
    const prev = result[result.length - 1]
    if (prev && prev.type === 'user' && msg.type === 'user') {
      // Accumulate content blocks into the existing merged message (avoids O(n^2) re-spreading)
      const prevContent = prev.message.content as ContentBlockParam[]
      prevContent.push(...toContentBlocks(msg.message.content))
      if (msg.isMeta) prev.isMeta = true
    } else if (msg.type === 'user') {
      // Start a new merge run — clone so we don't mutate the caller's message
      const merged: UserMessage = {
        type: 'user',
        uuid: msg.uuid,
        timestamp: msg.timestamp,
        message: { role: 'user', content: [...toContentBlocks(msg.message.content)] },
      }
      if (msg.isMeta) merged.isMeta = true
      result.push(merged)
    } else {
      result.push(msg)
    }
  }

  return result
}
