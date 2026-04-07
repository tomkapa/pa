import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage, Message } from '../../types/message.js'
import { normalizeMessagesForAPI } from '../messages/normalize.js'
import { createSystemMessage } from '../messages/factory.js'
import { isToolResultBlock } from '../messages/predicates.js'
import { getErrorMessage } from '../../utils/error.js'
import {
  endInteractionSpan,
  endLLMRequestSpan,
  endToolSpan,
  logForDebugging,
  startInteractionSpan,
  startLLMRequestSpan,
  startToolSpan,
} from '../observability/index.js'
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

function lastUserText(messages: readonly Message[]): string {
  const last = messages.at(-1)
  if (!last || last.type !== 'user') return ''
  const content = last.message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
      return block.text
    }
  }
  return ''
}

/** Sum text-block lengths in a tool_result `content` field. Cheap stand-in for `JSON.stringify(...).length`. */
function toolResultTextSize(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const part of content) {
    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
      n += part.text.length
    }
  }
  return n
}

export async function* queryLoop(
  params: AgentQueryParams,
): AsyncGenerator<AgentEvent, Terminal> {
  const { systemPrompt, maxTurns = DEFAULT_MAX_TURNS, abortSignal, deps } = params

  const state: LoopState = {
    messages: [...params.messages],
    turnCount: 0,
  }

  const interactionSpan = startInteractionSpan(lastUserText(state.messages))
  logForDebugging(`agent: interaction started (${state.messages.length} messages)`, { level: 'info' })

  let terminal: Terminal | undefined

  try {
    while (true) {
      if (state.turnCount >= maxTurns) {
        yield createSystemMessage({
          subtype: 'max_turns_reached',
          content: `Reached maximum number of turns (${maxTurns})`,
          level: 'warning',
        })
        terminal = { reason: 'max_turns', turnCount: state.turnCount }
        return terminal
      }

      if (abortSignal?.aborted) {
        terminal = { reason: 'aborted', turnCount: state.turnCount }
        return terminal
      }

      const apiMessages = normalizeMessagesForAPI(state.messages)
      const messageParams: CallModelParams['messages'] = apiMessages.map(m => ({
        role: m.message.role as 'user' | 'assistant',
        content: m.message.content as string | ContentBlockParam[],
      }))

      let assistantMessage: AssistantMessage | undefined

      const llmSpan = startLLMRequestSpan('claude', messageParams.length)
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
        endLLMRequestSpan(llmSpan, { stopReason: 'error' })
        if (isAbortError(error)) {
          terminal = { reason: 'aborted', turnCount: state.turnCount }
          return terminal
        }

        const msg = getErrorMessage(error)
        logForDebugging(`agent: model error — ${msg}`, { level: 'error' })
        yield createSystemMessage({
          subtype: 'model_error',
          content: `Model error: ${msg}`,
          level: 'error',
        })
        terminal = {
          reason: 'model_error',
          error: error instanceof Error ? error : new Error(msg),
          turnCount: state.turnCount,
        }
        return terminal
      }

      if (!assistantMessage) {
        endLLMRequestSpan(llmSpan, { stopReason: 'no_message' })
        const err = new Error('No assistant message received from model')
        logForDebugging(`agent: ${err.message}`, { level: 'error' })
        yield createSystemMessage({
          subtype: 'model_error',
          content: err.message,
          level: 'error',
        })
        terminal = { reason: 'model_error', error: err, turnCount: state.turnCount }
        return terminal
      }

      const usage = assistantMessage.message.usage
      endLLMRequestSpan(llmSpan, {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? undefined,
        stopReason: assistantMessage.message.stop_reason,
        requestId: assistantMessage.requestId,
      })

      state.messages.push(assistantMessage)
      state.turnCount++

      const toolUseBlocks = extractToolUseBlocks(assistantMessage.message.content)

      if (toolUseBlocks.length === 0) {
        terminal = { reason: 'completed', turnCount: state.turnCount }
        return terminal
      }

      // Index spans by tool_use_id so out-of-order results still close the right one.
      const openToolSpans = new Map<string, ReturnType<typeof startToolSpan>>()
      for (const block of toolUseBlocks) {
        openToolSpans.set(block.id, startToolSpan(block.name, block.input))
      }

      for await (const event of deps.executeToolBatch({
        toolUseBlocks,
        assistantMessageUUID: assistantMessage.uuid,
        abortSignal,
      })) {
        if (event.type === 'progress') {
          // UI-only — yield to consumers (REPL) but don't push to history.
          // Progress events are never serialized to the API.
          yield event
          continue
        }
        if (event.type !== 'tool_result') continue
        yield event.message
        state.messages.push(event.message)

        const content = event.message.message.content
        if (!Array.isArray(content)) continue
        for (const part of content) {
          if (!isToolResultBlock(part)) continue
          const span = openToolSpans.get(part.tool_use_id)
          if (!span) continue
          endToolSpan(span, {
            success: part.is_error !== true,
            outputSize: toolResultTextSize(part.content),
          })
          openToolSpans.delete(part.tool_use_id)
        }
      }

      // Spans still open belong to tools that never returned a result (e.g. cancelled).
      for (const span of openToolSpans.values()) {
        endToolSpan(span, { success: false })
      }
    }
  } finally {
    endInteractionSpan(interactionSpan, {
      finalTokenCount:
        terminal?.reason === 'completed' ? state.messages.length : undefined,
    })
    logForDebugging(
      `agent: interaction ended (reason=${terminal?.reason ?? 'unknown'}, turns=${state.turnCount})`,
      { level: 'info' },
    )
  }
}
