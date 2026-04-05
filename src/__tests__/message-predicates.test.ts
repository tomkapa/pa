import { describe, test, expect } from 'bun:test'
import type { Message, UserMessage, AssistantMessage, SystemMessage } from '../types/message.js'

const MODULE_PATH = '../services/messages/predicates.js'

function makeUserMessage(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ...overrides,
  }
}

function makeAssistantMessage(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'hi', citations: null }],
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

function makeSystemMessage(overrides: Partial<SystemMessage> = {}): SystemMessage {
  return {
    type: 'system',
    subtype: 'informational',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    content: 'info',
    level: 'info',
    ...overrides,
  }
}

describe('isHumanTurn', () => {
  test('returns true for plain user message', async () => {
    const { isHumanTurn } = await import(MODULE_PATH)
    const msg = makeUserMessage()
    expect(isHumanTurn(msg)).toBe(true)
  })

  test('returns false for meta user message', async () => {
    const { isHumanTurn } = await import(MODULE_PATH)
    const msg = makeUserMessage({ isMeta: true })
    expect(isHumanTurn(msg)).toBe(false)
  })

  test('returns false for tool_result user message', async () => {
    const { isHumanTurn } = await import(MODULE_PATH)
    const msg = makeUserMessage({
      toolUseResult: { type: 'tool_result', tool_use_id: 'tu_1', content: 'done' },
    })
    expect(isHumanTurn(msg)).toBe(false)
  })

  test('returns false for meta + tool_result user message', async () => {
    const { isHumanTurn } = await import(MODULE_PATH)
    const msg = makeUserMessage({
      isMeta: true,
      toolUseResult: { type: 'tool_result', tool_use_id: 'tu_1', content: 'done' },
    })
    expect(isHumanTurn(msg)).toBe(false)
  })

  test('returns false for assistant message', async () => {
    const { isHumanTurn } = await import(MODULE_PATH)
    const msg = makeAssistantMessage()
    expect(isHumanTurn(msg)).toBe(false)
  })

  test('returns false for system message', async () => {
    const { isHumanTurn } = await import(MODULE_PATH)
    const msg = makeSystemMessage()
    expect(isHumanTurn(msg)).toBe(false)
  })
})

describe('isApiMessage', () => {
  test('returns true for user messages', async () => {
    const { isApiMessage } = await import(MODULE_PATH)
    expect(isApiMessage(makeUserMessage())).toBe(true)
  })

  test('returns true for assistant messages', async () => {
    const { isApiMessage } = await import(MODULE_PATH)
    expect(isApiMessage(makeAssistantMessage())).toBe(true)
  })

  test('returns false for system messages (non local_command)', async () => {
    const { isApiMessage } = await import(MODULE_PATH)
    expect(isApiMessage(makeSystemMessage())).toBe(false)
  })

  test('returns true for local_command system messages', async () => {
    const { isApiMessage } = await import(MODULE_PATH)
    const msg = makeSystemMessage({ subtype: 'local_command' })
    expect(isApiMessage(msg)).toBe(true)
  })
})
