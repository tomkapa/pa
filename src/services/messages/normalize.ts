import type {
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
  return m as ApiMessageOutput
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
