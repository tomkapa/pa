import type {
  ContentBlockParam,
  ApiMessage,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  CompactMetadata,
  CompactTrigger,
} from '../../types/message.js'
import { COMPACT_BOUNDARY_SUBTYPE } from '../../types/message.js'

// ---------------------------------------------------------------------------
// Factory: UserMessage
// ---------------------------------------------------------------------------

export interface CreateUserMessageParams {
  content: string | ContentBlockParam[]
  isMeta?: true
  toolUseResult?: unknown
  toolName?: string
  sourceToolAssistantUUID?: string
  uuid?: string
}

export function createUserMessage(params: CreateUserMessageParams): UserMessage {
  const normalizedContent = toContentBlocks(params.content)

  const msg: UserMessage = {
    type: 'user',
    uuid: params.uuid ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: normalizedContent,
    },
  }

  if (params.isMeta) msg.isMeta = true
  if (params.toolUseResult !== undefined) msg.toolUseResult = params.toolUseResult
  if (params.toolName !== undefined) msg.toolName = params.toolName
  if (params.sourceToolAssistantUUID !== undefined) {
    msg.sourceToolAssistantUUID = params.sourceToolAssistantUUID
  }

  return msg
}

// ---------------------------------------------------------------------------
// Factory: AssistantMessage
// ---------------------------------------------------------------------------

export interface CreateAssistantMessageParams {
  apiResponse: ApiMessage
  requestId?: string
}

export function createAssistantMessage(params: CreateAssistantMessageParams): AssistantMessage {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: params.apiResponse,
    requestId: params.requestId,
  }
}

// ---------------------------------------------------------------------------
// Factory: SystemMessage
// ---------------------------------------------------------------------------

export interface CreateSystemMessageParams {
  subtype: string
  content: string
  level: 'info' | 'warning' | 'error'
}

export function createSystemMessage(params: CreateSystemMessageParams): SystemMessage {
  return {
    type: 'system',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    subtype: params.subtype,
    content: params.content,
    level: params.level,
  }
}

// ---------------------------------------------------------------------------
// Factory: Compact boundary marker
//
// A `compact_boundary` SystemMessage is the fence between pre-compact and
// post-compact history. It carries metadata describing why/how the compact
// happened. Messages before the *latest* boundary are kept in local UI state
// for scrollback but skipped when assembling the API request payload (see
// `getMessagesAfterCompactBoundary`).
// ---------------------------------------------------------------------------

export interface CreateCompactBoundaryParams {
  trigger: CompactTrigger
  preCompactTokenCount: number
  previousLastMessageUuid?: string
  content?: string
}

export function createCompactBoundaryMessage(
  params: CreateCompactBoundaryParams,
): SystemMessage {
  const metadata: CompactMetadata = {
    trigger: params.trigger,
    preCompactTokenCount: params.preCompactTokenCount,
    previousLastMessageUuid: params.previousLastMessageUuid,
  }

  return {
    type: 'system',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    subtype: COMPACT_BOUNDARY_SUBTYPE,
    content: params.content ?? `Conversation compacted (${params.trigger})`,
    level: 'info',
    compactMetadata: metadata,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toContentBlocks(content: string | ContentBlockParam[]): ContentBlockParam[] {
  if (Array.isArray(content)) return content

  const text = content.length === 0 ? '(no content)' : content
  return [{ type: 'text', text }]
}

/**
 * Concatenate every `text` block in a content payload into a single string.
 * Non-text blocks (tool_use, tool_result, image, document, …) contribute
 * nothing. Used by anything that needs the "human-readable text" of a
 * message — UI rendering, summarizer post-processing, debug logs.
 *
 * Accepts both `ContentBlockParam[]` (request side) and `ContentBlock[]`
 * (response side) since both share the same `type === 'text'` discriminant.
 */
export function extractTextFromContent(
  content: string | ReadonlyArray<{ type: string; text?: string }>,
): string {
  if (typeof content === 'string') return content
  let out = ''
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}
