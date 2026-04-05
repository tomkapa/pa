import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage } from '../../types/message.js'
import { normalizeMessagesForAPI } from '../messages/normalize.js'
import { createSystemMessage, createUserMessage } from '../messages/factory.js'
import type {
  AgentEvent,
  AgentQueryParams,
  CallModelParams,
  ContentBlockParam,
  LoopState,
  Terminal,
  ToolResult,
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

function buildToolResultUserMessage(
  result: ToolResult,
  sourceAssistantUUID: string,
  uuid: string,
) {
  return createUserMessage({
    content: [{
      type: 'tool_result',
      tool_use_id: result.toolUseId,
      content: result.content,
      is_error: result.isError || undefined,
    }],
    isMeta: true,
    toolUseResult: result,
    sourceToolAssistantUUID: sourceAssistantUUID,
    uuid,
  })
}

export async function* queryLoop(
  params: AgentQueryParams,
): AsyncGenerator<AgentEvent, Terminal> {
  const { systemPrompt, maxTurns = DEFAULT_MAX_TURNS, abortSignal, deps } = params

  const state: LoopState = {
    messages: [...params.messages],
    toolUseContext: params.toolUseContext ?? {},
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

      const errorMessage = error instanceof Error ? error.message : String(error)
      yield createSystemMessage({
        subtype: 'model_error',
        content: `Model error: ${errorMessage}`,
        level: 'error',
      })
      return {
        reason: 'model_error',
        error: error instanceof Error ? error : new Error(errorMessage),
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

    for (let i = 0; i < toolUseBlocks.length; i++) {
      const toolUse = toolUseBlocks[i]!

      if (abortSignal?.aborted) {
        for (let j = i; j < toolUseBlocks.length; j++) {
          const remaining = toolUseBlocks[j]!
          const errorMsg = buildToolResultUserMessage(
            { toolUseId: remaining.id, content: 'Aborted', isError: true },
            assistantMessage.uuid,
            deps.uuid(),
          )
          yield errorMsg
          state.messages.push(errorMsg)
        }
        return { reason: 'aborted', turnCount: state.turnCount }
      }

      let result: ToolResult
      try {
        result = await deps.executeTool(toolUse, state.toolUseContext)
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        result = {
          toolUseId: toolUse.id,
          content: `Tool execution error: ${errorMessage}`,
          isError: true,
        }
      }

      const userMsg = buildToolResultUserMessage(
        result,
        assistantMessage.uuid,
        deps.uuid(),
      )
      yield userMsg
      state.messages.push(userMsg)
    }
  }
}
