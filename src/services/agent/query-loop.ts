import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage, Message } from '../../types/message.js'
import { toApiMessageParams } from '../messages/normalize.js'
import { createSystemMessage, extractTextFromContent } from '../messages/factory.js'
import {
  getMessagesAfterCompactBoundary,
  isHumanTurn,
  isToolResultBlock,
} from '../messages/predicates.js'
import { getErrorMessage } from '../../utils/error.js'
import { buildPostCompactMessages, createInitialAutoCompactTracking } from './auto-compact.js'
import { detectEffortLevel, type EffortLevel } from './thinking.js'
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

/**
 * Detect the extended-thinking effort keyword on the most recent human turn,
 * skipping tool_results and other meta user messages. The keyword is set
 * once by the human and stays in effect across every model call inside the
 * same user turn — even after the loop has folded in tool_use round-trips.
 */
function effortFromLastHumanTurn(messages: readonly Message[]): EffortLevel {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (!isHumanTurn(m)) continue
    return detectEffortLevel(extractTextFromContent(m.message.content))
  }
  return 'off'
}

export async function* queryLoop(
  params: AgentQueryParams,
): AsyncGenerator<AgentEvent, Terminal> {
  const { systemPrompt, maxTurns = DEFAULT_MAX_TURNS, abortSignal, deps } = params

  const state: LoopState = {
    messages: [...params.messages],
    turnCount: 0,
    autoCompactTracking: createInitialAutoCompactTracking(),
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

      // Auto-compact runs *before* the model API call so we never send an
      // over-the-limit request. Pre-boundary history stays in `state.messages`
      // for REPL scrollback but never reaches the API.
      let visibleMessages = getMessagesAfterCompactBoundary(state.messages)
      if (deps.autoCompact) {
        const outcome = await deps.autoCompact({
          messages: visibleMessages,
          systemPrompt,
          tracking: state.autoCompactTracking,
          abortSignal,
        })
        state.autoCompactTracking = outcome.tracking
        if (outcome.compactionResult) {
          const postCompact = buildPostCompactMessages(outcome.compactionResult)
          for (const msg of postCompact) {
            yield msg
            state.messages.push(msg)
          }
          // postCompact is by construction already a post-boundary slice.
          visibleMessages = postCompact
          logForDebugging(
            `agent: auto-compact fired (pre=${outcome.compactionResult.preCompactTokenCount} tokens)`,
            { level: 'info' },
          )
        }
      }

      // Drain any messages the user buffered during the previous iteration
      // (typically while tool execution was running). These become a fresh
      // user turn in the next API call — the agent picks them up at the
      // natural pause between iterations instead of having to wait for the
      // whole run to terminate. Iteration 1 typically sees an empty queue
      // because the initial submission went straight into state.messages.
      if (deps.drainQueuedInput) {
        const drained = await deps.drainQueuedInput()
        if (drained.length > 0) {
          for (const msg of drained) {
            yield msg
            state.messages.push(msg)
            visibleMessages = [...visibleMessages, msg]
          }
          logForDebugging(
            `agent: drained ${drained.length} queued user message(s) between iterations`,
            { level: 'info' },
          )
        }
      }

      const messageParams: CallModelParams['messages'] = toApiMessageParams(visibleMessages)
      const effort = effortFromLastHumanTurn(visibleMessages)

      let assistantMessage: AssistantMessage | undefined

      const llmSpan = startLLMRequestSpan({
        model: 'claude',
        messageCount: messageParams.length,
        parent: interactionSpan,
        // Feed the Langfuse Input panel the exact messages the agent sent
        // to the model — this is the high-value payload for debugging.
        input: messageParams,
      })
      try {
        for await (const event of deps.callModel({
          messages: messageParams,
          systemPrompt,
          effort,
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
        // Assistant response blocks (text + tool_use) -> Langfuse Output panel.
        output: assistantMessage.message.content,
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
        openToolSpans.set(
          block.id,
          startToolSpan({
            toolName: block.name,
            input: block.input,
            parent: interactionSpan,
          }),
        )
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
            // Tool result content -> Langfuse Output panel. The tracer
            // also derives PA_TOOL_OUTPUT_SIZE from this and handles
            // truncation so a huge Read/Bash payload can't balloon the
            // OTLP batch.
            output: part.content,
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
