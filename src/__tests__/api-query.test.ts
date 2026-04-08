import { describe, test, expect, mock } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import type {
  RawMessageStreamEvent,
  Message,
} from '@anthropic-ai/sdk/resources/messages/messages'
import { queryWithStreaming, queryWithoutStreaming } from '../services/api/query.js'
import type { AssistantMessage, StreamEvent } from '../types/streamEvents.js'

/**
 * Creates a mock Anthropic client whose messages.create returns
 * a mock APIPromise with .withResponse() that yields the given events.
 */
function createMockClient(events: RawMessageStreamEvent[]): Anthropic {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
    },
    controller: new AbortController(),
  }

  // The SDK's create() returns an APIPromise which has .withResponse() on it directly
  // (not on the resolved value). We simulate this with a thenable that also has .withResponse().
  const createFn = mock(() => {
    const apiPromise = {
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(mockStream).then(resolve, reject),
      withResponse: () => Promise.resolve({
        data: mockStream,
        request_id: 'req-test-123',
        response: new Response(),
      }),
    }
    return apiPromise
  })

  return {
    messages: { create: createFn },
  } as unknown as Anthropic
}

function baseMessage(): Message {
  return {
    id: 'msg-test-001',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 10,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  }
}

function textStreamEvents(text: string): RawMessageStreamEvent[] {
  const msg = baseMessage()
  return [
    { type: 'message_start', message: msg },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', citations: null },
    },
    ...text.split('').map((ch): RawMessageStreamEvent => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: ch },
    })),
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null, container: null },
      usage: {
        output_tokens: 5,
        input_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
      },
    },
    { type: 'message_stop' },
  ]
}

function toolUseStreamEvents(): RawMessageStreamEvent[] {
  const msg = baseMessage()
  return [
    { type: 'message_start', message: msg },
    {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_001',
        name: 'read_file',
        input: {},
        caller: { type: 'direct' },
      },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"pa' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: 'th":"src/' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: 'index.ts"}' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null, stop_details: null, container: null },
      usage: {
        output_tokens: 20,
        input_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
      },
    },
    { type: 'message_stop' },
  ]
}

const defaultParams = {
  model: 'claude-sonnet-4-20250514' as const,
  max_tokens: 1024,
  messages: [{ role: 'user' as const, content: 'Hello' }],
}

describe('queryWithStreaming', () => {
  test('yields stream events for each SSE event', async () => {
    const events = textStreamEvents('Hi')
    const client = createMockClient(events)

    const received: StreamEvent[] = []
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'stream_event') {
        received.push(event)
      }
    }

    // Should yield one stream_event per SSE event
    expect(received).toHaveLength(events.length)
    expect(received[0]!.event.type).toBe('message_start')
  })

  test('yields assistant message at the end with accumulated text', async () => {
    const client = createMockClient(textStreamEvents('Hello world'))

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') {
        assistantMsg = event
      }
    }

    expect(assistantMsg).toBeDefined()
    expect(assistantMsg!.message.content).toHaveLength(1)
    const block = assistantMsg!.message.content[0]!
    expect(block.type).toBe('text')
    if (block.type === 'text') {
      expect(block.text).toBe('Hello world')
    }
  })

  test('records TTFT on message_start', async () => {
    const client = createMockClient(textStreamEvents('x'))

    const firstStreamEvent = (await collectStreamEvents(client))[0]!
    expect(firstStreamEvent.event.type).toBe('message_start')
    expect(firstStreamEvent.ttftMs).toBeGreaterThan(0)
  })

  test('accumulates tool use input from JSON deltas', async () => {
    const client = createMockClient(toolUseStreamEvents())

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') {
        assistantMsg = event
      }
    }

    expect(assistantMsg).toBeDefined()
    const block = assistantMsg!.message.content[0]!
    expect(block.type).toBe('tool_use')
    if (block.type === 'tool_use') {
      expect(block.input).toEqual({ path: 'src/index.ts' })
      expect(block.name).toBe('read_file')
      expect(block.id).toBe('toolu_001')
    }
  })

  test('tracks token usage from message_start and message_delta', async () => {
    const client = createMockClient(textStreamEvents('x'))

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') {
        assistantMsg = event
      }
    }

    const usage = assistantMsg!.message.usage
    expect(usage.input_tokens).toBe(10)
    expect(usage.output_tokens).toBe(5)
  })

  test('sets requestId from response', async () => {
    const client = createMockClient(textStreamEvents('x'))

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') {
        assistantMsg = event
      }
    }

    expect(assistantMsg!.requestId).toBe('req-test-123')
  })

  test('sets stop_reason from message_delta', async () => {
    const client = createMockClient(textStreamEvents('x'))

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') {
        assistantMsg = event
      }
    }

    expect(assistantMsg!.message.stop_reason).toBe('end_turn')
  })

  test('generates uuid and timestamp on assistant message', async () => {
    const client = createMockClient(textStreamEvents('x'))

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') {
        assistantMsg = event
      }
    }

    expect(assistantMsg!.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(new Date(assistantMsg!.timestamp).getTime()).not.toBeNaN()
  })

  test('does not overwrite input_tokens with zero from message_delta', async () => {
    const msg = baseMessage()
    msg.usage.input_tokens = 42

    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: msg },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null, container: null },
        usage: {
          output_tokens: 3,
          input_tokens: 0,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
        },
      },
      { type: 'message_stop' },
    ]
    const client = createMockClient(events)

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') {
        assistantMsg = event
      }
    }

    expect(assistantMsg!.message.usage.input_tokens).toBe(42)
    expect(assistantMsg!.message.usage.output_tokens).toBe(3)
  })

  test('handles multiple content blocks (text + tool_use)', async () => {
    const msg = baseMessage()
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: msg },
      // First block: text
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Let me read that file.' },
      },
      { type: 'content_block_stop', index: 0 },
      // Second block: tool_use
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'toolu_002',
          name: 'read_file',
          input: {},
          caller: { type: 'direct' },
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"path":"test.ts"}' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null, stop_details: null, container: null },
        usage: {
          output_tokens: 15,
          input_tokens: null,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
        },
      },
      { type: 'message_stop' },
    ]
    const client = createMockClient(events)

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') {
        assistantMsg = event
      }
    }

    expect(assistantMsg!.message.content).toHaveLength(2)
    const [textBlock, toolBlock] = assistantMsg!.message.content
    expect(textBlock!.type).toBe('text')
    if (textBlock!.type === 'text') {
      expect(textBlock!.text).toBe('Let me read that file.')
    }
    expect(toolBlock!.type).toBe('tool_use')
    if (toolBlock!.type === 'tool_use') {
      expect(toolBlock!.input).toEqual({ path: 'test.ts' })
    }
  })

  test('propagates AbortError without logging', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        throw abortError
      },
      controller: new AbortController(),
    }

    const client = {
      messages: {
        create: mock(() => ({
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(mockStream).then(resolve, reject),
          withResponse: () => Promise.resolve({
            data: mockStream,
            request_id: null,
            response: new Response(),
          }),
        })),
      },
    } as unknown as Anthropic

    const gen = queryWithStreaming(client, defaultParams)
    await expect(collectAll(gen)).rejects.toThrow('The operation was aborted')
  })
})

describe('queryWithoutStreaming', () => {
  test('returns the final assistant message', async () => {
    const client = createMockClient(textStreamEvents('Hello'))
    const result = await queryWithoutStreaming(client, defaultParams)

    expect(result.type).toBe('assistant')
    expect(result.message.content).toHaveLength(1)
    if (result.message.content[0]!.type === 'text') {
      expect(result.message.content[0]!.text).toBe('Hello')
    }
  })

  test('throws a descriptive error when the stream is empty', async () => {
    // Empty stream — no events. The streaming layer should surface the
    // empty-stream condition explicitly so callers don't see a misleading
    // "no assistant message" error downstream.
    const client = createMockClient([])
    await expect(queryWithoutStreaming(client, defaultParams)).rejects.toThrow(
      /Empty stream from Anthropic API/,
    )
  })
})

// Helpers

async function collectStreamEvents(client: Anthropic): Promise<StreamEvent[]> {
  const result: StreamEvent[] = []
  for await (const event of queryWithStreaming(client, defaultParams)) {
    if (event.type === 'stream_event') {
      result.push(event)
    }
  }
  return result
}

async function collectAll<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of gen) {
    result.push(item)
  }
  return result
}
