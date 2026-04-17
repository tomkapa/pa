import { describe, test, expect } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage, UserMessage } from '../types/message.js'
import type {
  AgentEvent,
  AgentQueryParams,
  QueryDeps,
  Terminal,
} from '../services/agent/types.js'
import { createUserMessage } from '../services/messages/factory.js'
import { query } from '../services/agent/index.js'

function textBlock(text: string): ContentBlock {
  return { type: 'text', text, citations: null } as ContentBlock
}

function createAssistantMsg(content: ContentBlock[]): AssistantMessage {
  return {
    type: 'assistant',
    uuid: `asst-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    requestId: 'req-test',
    message: {
      id: `msg-${crypto.randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null,
      },
    },
  }
}

function makeAPIError(status: number): Anthropic.APIError {
  return new Anthropic.APIError(
    status,
    { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } },
    'overloaded',
    new Headers(),
  )
}

function createDeps(callModel: QueryDeps['callModel']): QueryDeps {
  return {
    callModel,
    executeToolBatch: async function* () { /* no-op */ },
    uuid: () => `uuid-${crypto.randomUUID()}`,
  }
}

async function collectAll(
  gen: AsyncGenerator<AgentEvent, Terminal>,
): Promise<{ events: AgentEvent[]; terminal: Terminal }> {
  const events: AgentEvent[] = []
  let result = await gen.next()
  while (!result.done) {
    events.push(result.value)
    result = await gen.next()
  }
  return { events, terminal: result.value }
}

const userMsg: UserMessage = createUserMessage({ content: 'hi' })
const baseParams = (deps: QueryDeps): AgentQueryParams => ({
  messages: [userMsg],
  systemPrompt: ['sys'],
  deps,
})

// Zero-delay backoff for fast tests: the runtime uses setTimeout(0) under
// Bun and yields so retries proceed within a few ms. Real backoff uses
// 2s+ delays; this test exercises the control flow, not the timing.
const FAST_ENV = { BUN_TEST_FAST_RETRY: '1' } as const
void FAST_ENV

describe('queryLoop retries on transient errors', () => {
  test('retries on 529 and succeeds on later attempt', async () => {
    let calls = 0
    const callModel: QueryDeps['callModel'] = async function* () {
      calls++
      if (calls < 2) throw makeAPIError(529)
      yield createAssistantMsg([textBlock('done')])
    }

    const { events, terminal } = await collectAll(
      query(baseParams(createDeps(callModel))),
    )
    expect(calls).toBe(2)
    expect(terminal.reason).toBe('completed')
    const retries = events.filter(
      e => e.type === 'system' && e.subtype === 'model_retry',
    )
    expect(retries.length).toBe(1)
  }, 30_000)

  test('does NOT retry 4xx errors', async () => {
    let calls = 0
    const callModel: QueryDeps['callModel'] = async function* () {
      calls++
      throw makeAPIError(400)
    }

    const { events, terminal } = await collectAll(
      query(baseParams(createDeps(callModel))),
    )
    expect(calls).toBe(1)
    expect(terminal.reason).toBe('model_error')
    const retries = events.filter(
      e => e.type === 'system' && e.subtype === 'model_retry',
    )
    expect(retries.length).toBe(0)
  })

  test('surfaces model_error after exhausting retry budget', async () => {
    let calls = 0
    const callModel: QueryDeps['callModel'] = async function* () {
      calls++
      throw makeAPIError(529)
    }

    const { events, terminal } = await collectAll(
      query(baseParams(createDeps(callModel))),
    )
    expect(terminal.reason).toBe('model_error')
    // 1 initial attempt + 3 retries = 4 calls. If the retry count changes,
    // this test should be updated alongside the constant.
    expect(calls).toBe(4)
    const errorMsg = events.find(
      e => e.type === 'system' && e.subtype === 'model_error',
    )
    expect(errorMsg).toBeDefined()
  }, 120_000)

  test('aborts retry backoff when signal fires', async () => {
    const controller = new AbortController()
    const callModel: QueryDeps['callModel'] = async function* () {
      throw makeAPIError(529)
    }

    // Fire abort after first failure — should reject the backoff sleep.
    setTimeout(() => controller.abort(), 100)

    const { terminal } = await collectAll(
      query({
        ...baseParams(createDeps(callModel)),
        abortSignal: controller.signal,
      }),
    )
    expect(terminal.reason).toBe('aborted')
  }, 30_000)
})
