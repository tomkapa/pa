import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlock,
  MessageCreateParamsBase,
  RawMessageStreamEvent,
  StopReason,
} from '@anthropic-ai/sdk/resources/messages/messages'
import type { Stream } from '@anthropic-ai/sdk/core/streaming'
import type { AssistantMessage, QueryEvent, StreamEvent } from '../../types/streamEvents.js'
import { emptyUsage, mergeUsage, type TokenUsage } from '../../types/streamEvents.js'

export interface QueryParams extends Omit<MessageCreateParamsBase, 'stream'> {
  abortSignal?: AbortSignal
}

interface StreamAccumulator {
  messageId: string
  model: string
  stopReason: StopReason | null
  usage: TokenUsage
  contentBlocks: ContentBlock[]
  /** Raw JSON strings for tool_use blocks, keyed by block index */
  toolInputBuffers: Map<number, string>
}

function createAccumulator(): StreamAccumulator {
  return {
    messageId: '',
    model: '',
    stopReason: null,
    usage: emptyUsage(),
    contentBlocks: [],
    toolInputBuffers: new Map(),
  }
}

function applyContentBlockStart(acc: StreamAccumulator, event: Extract<RawMessageStreamEvent, { type: 'content_block_start' }>): void {
  const block = { ...event.content_block }

  if (block.type === 'tool_use') {
    // Initialize raw JSON buffer — will be built from input_json_delta events
    acc.toolInputBuffers.set(event.index, '')
    // Set input to empty object for now, will be replaced at content_block_stop
    ;(block as { input: unknown }).input = {}
  }

  acc.contentBlocks[event.index] = block
}

function applyContentBlockDelta(acc: StreamAccumulator, event: Extract<RawMessageStreamEvent, { type: 'content_block_delta' }>): void {
  const block = acc.contentBlocks[event.index]
  if (!block) return

  const delta = event.delta
  switch (delta.type) {
    case 'text_delta':
      if (block.type === 'text') {
        ;(block as { text: string }).text += delta.text
      }
      break
    case 'input_json_delta': {
      const existing = acc.toolInputBuffers.get(event.index) ?? ''
      acc.toolInputBuffers.set(event.index, existing + delta.partial_json)
      break
    }
    case 'thinking_delta':
      if (block.type === 'thinking') {
        ;(block as { thinking: string }).thinking += delta.thinking
      }
      break
  }
}

function finalizeToolInput(acc: StreamAccumulator, index: number): void {
  const block = acc.contentBlocks[index]
  if (!block || block.type !== 'tool_use') return

  const raw = acc.toolInputBuffers.get(index)
  if (raw != null && raw.length > 0) {
    try {
      ;(block as { input: unknown }).input = JSON.parse(raw) as unknown
    } catch (cause) {
      throw new Error(
        `Failed to parse tool input JSON for block ${index} (tool: ${block.name})`,
        { cause },
      )
    }
  }
  acc.toolInputBuffers.delete(index)
}

export async function* queryWithStreaming(
  client: Anthropic,
  params: QueryParams,
): AsyncGenerator<QueryEvent> {
  const { abortSignal, ...createParams } = params
  const startTime = performance.now()
  let ttftRecorded = false

  const response = await client.messages
    .create({ ...createParams, stream: true }, { signal: abortSignal })
    .withResponse()

  const stream: Stream<RawMessageStreamEvent> = response.data
  const requestId = response.request_id ?? undefined

  const acc = createAccumulator()

  try {
    for await (const event of stream) {
      const streamEvent: StreamEvent = { type: 'stream_event', event }

      switch (event.type) {
        case 'message_start': {
          acc.messageId = event.message.id
          acc.model = event.message.model
          acc.usage = mergeUsage(acc.usage, event.message.usage)

          if (!ttftRecorded) {
            streamEvent.ttftMs = performance.now() - startTime
            ttftRecorded = true
          }
          break
        }
        case 'content_block_start':
          applyContentBlockStart(acc, event)
          break
        case 'content_block_delta':
          applyContentBlockDelta(acc, event)
          break
        case 'content_block_stop':
          finalizeToolInput(acc, event.index)
          break
        case 'message_delta':
          acc.stopReason = event.delta.stop_reason ?? acc.stopReason
          acc.usage = mergeUsage(acc.usage, event.usage)
          break
      }

      yield streamEvent
    }
  } catch (error: unknown) {
    if (error instanceof Anthropic.APIUserAbortError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    if (error instanceof Anthropic.APIConnectionError) {
      console.error(`Anthropic connection error: ${error.message}`, {
        messageId: acc.messageId || undefined,
        model: acc.model || undefined,
        requestId,
      })
      throw error
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API error [${error.status}]: ${error.message}`, {
        messageId: acc.messageId || undefined,
        model: acc.model || undefined,
        requestId,
      })
      throw error
    }
    throw error
  }

  if (!acc.messageId) {
    // The stream closed cleanly without ever sending `message_start`. The
    // SDK's Stream parser exits silently in this case, so we have to surface
    // the failure ourselves — otherwise the caller sees an empty generator
    // and reports the misleading "No assistant message received from model".
    // Common upstream causes: a proxy that closes the body before SSE starts,
    // a 200-with-empty-body from a non-Anthropic gateway, or an early abort
    // that didn't propagate through the SDK as APIUserAbortError.
    throw new Error(
      `Empty stream from Anthropic API (no message_start received)${
        requestId ? ` [request ${requestId}]` : ''
      }`,
    )
  }

  const assistantMessage: AssistantMessage = {
    type: 'assistant',
    message: {
      id: acc.messageId,
      type: 'message',
      role: 'assistant',
      model: acc.model,
      content: acc.contentBlocks,
      stop_reason: acc.stopReason,
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: acc.usage.inputTokens,
        output_tokens: acc.usage.outputTokens,
        cache_creation_input_tokens: acc.usage.cacheCreationInputTokens,
        cache_read_input_tokens: acc.usage.cacheReadInputTokens,
        cache_creation: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null,
      },
    },
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    requestId,
  }

  yield assistantMessage
}

export async function queryWithoutStreaming(
  client: Anthropic,
  params: QueryParams,
): Promise<AssistantMessage> {
  let result: AssistantMessage | undefined
  for await (const event of queryWithStreaming(client, params)) {
    if (event.type === 'assistant') {
      result = event
    }
  }
  if (!result) {
    throw new Error('No assistant message received from stream')
  }
  return result
}
