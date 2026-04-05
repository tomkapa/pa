import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage } from '../../types/message.js'
import { normalizeMessagesForAPI } from '../messages/normalize.js'
import { createSystemMessage } from '../messages/factory.js'
import { getErrorMessage } from '../../utils/error.js'
import type {
  AgentEvent,
  AgentQueryParams,
  CallModelParams,
  ContentBlockParam,
  LoopState,
  Terminal,
  ToolUseInfo,
} from './types.js'

const DEFAULT_MAX_TURNS = 10

function extractToolUseBlocks(content: ContentBlock[]): ToolUseInfo[] {
  return content
    .filter((b): b is ContentBlock & ToolUseInfo => b.type === 'tool_use')
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && error.name === 'AbortError') return true
  return false
}

export async function* queryLoop(
  params: AgentQueryParams,
): AsyncGenerator<AgentEvent, Terminal> {
  const { systemPrompt, maxTurns = DEFAULT_MAX_TURNS, abortSignal, deps } = params

  const state: LoopState = {
    messages: [...params.messages],
    turnCount: 0,
  }

  while (true) {
    if (state.turnCount >= maxTurns) {
      yield createSystemMessage({
        subtype: 'max_turns_reached',
        content: `Reached maximum number of turns (${maxTurns})`,
        level: 'warning',
      })
      return { reason: 'max_turns', turnCount: state.turnCount }
    }

    if (abortSignal?.aborted) {
      return { reason: 'aborted', turnCount: state.turnCount }
    }

    const apiMessages = normalizeMessagesForAPI(state.messages)
    const messageParams: CallModelParams['messages'] = apiMessages.map(m => ({
      role: m.message.role as 'user' | 'assistant',
      content: m.message.content as string | ContentBlockParam[],
    }))

    let assistantMessage: AssistantMessage | undefined

    try {
      for await (const event of deps.callModel({
        messages: messageParams,
        systemPrompt,
        abortSignal,
      })) {
        yield event
        if (event.type === 'assistant') {
          assistantMessage = event
        }
      }
    } catch (error: unknown) {
      if (isAbortError(error)) {
        return { reason: 'aborted', turnCount: state.turnCount }
      }

      const msg = getErrorMessage(error)
      yield createSystemMessage({
        subtype: 'model_error',
        content: `Model error: ${msg}`,
        level: 'error',
      })
      return {
        reason: 'model_error',
        error: error instanceof Error ? error : new Error(msg),
        turnCount: state.turnCount,
      }
    }

    if (!assistantMessage) {
      const err = new Error('No assistant message received from model')
      yield createSystemMessage({
        subtype: 'model_error',
        content: err.message,
        level: 'error',
      })
      return { reason: 'model_error', error: err, turnCount: state.turnCount }
    }

    state.messages.push(assistantMessage)
    state.turnCount++

    const toolUseBlocks = extractToolUseBlocks(assistantMessage.message.content)

    if (toolUseBlocks.length === 0) {
      return { reason: 'completed', turnCount: state.turnCount }
    }

    for await (const event of deps.executeToolBatch({
      toolUseBlocks,
      assistantMessageUUID: assistantMessage.uuid,
      abortSignal,
    })) {
      if (event.type === 'tool_result') {
        yield event.message
        state.messages.push(event.message)
      }
    }
  }
}
