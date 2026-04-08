import { describe, test, expect, mock } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import type {
  RawMessageStreamEvent,
  Message,
} from '@anthropic-ai/sdk/resources/messages/messages'
import { queryWithStreaming } from '../services/api/query.js'
import type { AssistantMessage } from '../types/streamEvents.js'

function createMockClient(events: RawMessageStreamEvent[]): Anthropic {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event
    },
    controller: new AbortController(),
  }
  const createFn = mock(() => ({
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(mockStream).then(resolve, reject),
    withResponse: () => Promise.resolve({
      data: mockStream,
      request_id: 'req-test',
      response: new Response(),
    }),
  }))
  return { messages: { create: createFn } } as unknown as Anthropic
}

function baseMessage(): Message {
  return {
    id: 'msg-test',
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

const defaultParams = {
  model: 'claude-sonnet-4-20250514' as const,
  max_tokens: 1024,
  messages: [{ role: 'user' as const, content: 'Hi' }],
}

describe('queryWithStreaming — thinking blocks', () => {
  test('accumulates thinking_delta into a thinking block', async () => {
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: baseMessage() },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me ' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'consider this.' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '', citations: null },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Answer.' },
      },
      { type: 'content_block_stop', index: 1 },
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
    const client = createMockClient(events)

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') assistantMsg = event
    }

    expect(assistantMsg).toBeDefined()
    const blocks = assistantMsg!.message.content
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.type).toBe('thinking')
    if (blocks[0]!.type === 'thinking') {
      expect(blocks[0]!.thinking).toBe('Let me consider this.')
    }
    expect(blocks[1]!.type).toBe('text')
    if (blocks[1]!.type === 'text') {
      expect(blocks[1]!.text).toBe('Answer.')
    }
  })

  test('captures signature_delta on thinking blocks for cross-turn integrity', async () => {
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: baseMessage() },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Reasoning' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig-abc' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]
    const client = createMockClient(events)

    let assistantMsg: AssistantMessage | undefined
    for await (const event of queryWithStreaming(client, defaultParams)) {
      if (event.type === 'assistant') assistantMsg = event
    }

    const block = assistantMsg!.message.content[0]!
    expect(block.type).toBe('thinking')
    if (block.type === 'thinking') {
      expect(block.signature).toBe('sig-abc')
    }
  })

  test('throws when thinking_delta lands on a text block (protocol mismatch)', async () => {
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: baseMessage() },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      },
      // Bad: thinking_delta on a text block.
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'oops' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]
    const client = createMockClient(events)

    const run = async () => {
      for await (const _e of queryWithStreaming(client, defaultParams)) {
        void _e
      }
    }
    await expect(run()).rejects.toThrow(/Protocol error: thinking_delta/)
  })

  test('throws when text_delta lands on a thinking block (protocol mismatch)', async () => {
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: baseMessage() },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      // Bad: text_delta on a thinking block.
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'oops' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]
    const client = createMockClient(events)

    const run = async () => {
      for await (const _e of queryWithStreaming(client, defaultParams)) {
        void _e
      }
    }
    await expect(run()).rejects.toThrow(/Protocol error: text_delta/)
  })
})
