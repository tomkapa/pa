import type {
  ContentBlockParam,
  ApiMessage,
  UserMessage,
  AssistantMessage,
  SystemMessage,
} from '../../types/message.js'

// ---------------------------------------------------------------------------
// Factory: UserMessage
// ---------------------------------------------------------------------------

export interface CreateUserMessageParams {
  content: string | ContentBlockParam[]
  isMeta?: true
  toolUseResult?: unknown
  sourceToolAssistantUUID?: string
}

export function createUserMessage(params: CreateUserMessageParams): UserMessage {
  const normalizedContent = toContentBlocks(params.content)

  const msg: UserMessage = {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: normalizedContent,
    },
  }

  if (params.isMeta) msg.isMeta = true
  if (params.toolUseResult !== undefined) msg.toolUseResult = params.toolUseResult
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
// Helpers
// ---------------------------------------------------------------------------

export function toContentBlocks(content: string | ContentBlockParam[]): ContentBlockParam[] {
  if (Array.isArray(content)) return content

  const text = content.length === 0 ? '(no content)' : content
  return [{ type: 'text', text }]
}
