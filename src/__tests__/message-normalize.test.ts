import { describe, test, expect } from 'bun:test'
import type { Message, UserMessage, AssistantMessage, SystemMessage } from '../types/message.js'

const MODULE_PATH = '../services/messages/normalize.js'

function makeUser(content: string, overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text: content }] },
    ...overrides,
  }
}

function makeAssistant(text: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: `msg_${crypto.randomUUID().slice(0, 8)}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text, citations: null }],
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

function makeSystem(
  subtype: string = 'informational',
  content: string = 'info',
): SystemMessage {
  return {
    type: 'system',
    subtype,
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    content,
    level: 'info',
  }
}

describe('normalizeMessagesForAPI', () => {
  test('passes through alternating user/assistant messages', async () => {
    const { normalizeMessagesForAPI } = await import(MODULE_PATH)
    const messages: Message[] = [
      makeUser('hello'),
      makeAssistant('hi'),
      makeUser('how are you'),
      makeAssistant('good'),
    ]

    const result = normalizeMessagesForAPI(messages)
    expect(result).toHaveLength(4)
    expect(result[0]!.type).toBe('user')
    expect(result[1]!.type).toBe('assistant')
    expect(result[2]!.type).toBe('user')
    expect(result[3]!.type).toBe('assistant')
  })

  test('strips system messages', async () => {
    const { normalizeMessagesForAPI } = await import(MODULE_PATH)
    const messages: Message[] = [
      makeUser('hello'),
      makeSystem('informational', 'debug info'),
      makeAssistant('hi'),
    ]

    const result = normalizeMessagesForAPI(messages)
    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe('user')
    expect(result[1]!.type).toBe('assistant')
  })

  test('converts local_command system messages to user messages', async () => {
    const { normalizeMessagesForAPI } = await import(MODULE_PATH)
    const messages: Message[] = [
      makeUser('hello'),
      makeAssistant('hi'),
      makeSystem('local_command', '/help output here'),
      makeAssistant('here is help'),
    ]

    const result = normalizeMessagesForAPI(messages)
    expect(result).toHaveLength(4)
    expect(result[2]!.type).toBe('user')
    expect((result[2] as UserMessage).message.role).toBe('user')
  })

  test('merges consecutive user messages', async () => {
    const { normalizeMessagesForAPI } = await import(MODULE_PATH)
    const messages: Message[] = [
      makeUser('first'),
      makeUser('second'),
      makeAssistant('reply'),
    ]

    const result = normalizeMessagesForAPI(messages)
    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe('user')

    // Content blocks should be merged
    const userMsg = result[0] as UserMessage
    const content = userMsg.message.content
    expect(Array.isArray(content)).toBe(true)
    expect(content).toHaveLength(2)
  })

  test('handles empty message array', async () => {
    const { normalizeMessagesForAPI } = await import(MODULE_PATH)
    const result = normalizeMessagesForAPI([])
    expect(result).toEqual([])
  })

  test('merges multiple consecutive user messages with system messages stripped between them', async () => {
    const { normalizeMessagesForAPI } = await import(MODULE_PATH)
    const messages: Message[] = [
      makeUser('first'),
      makeSystem('informational', 'noise'),
      makeUser('second'),
      makeAssistant('reply'),
    ]

    const result = normalizeMessagesForAPI(messages)
    // After stripping system messages, two consecutive user messages should merge
    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe('user')
    expect(result[1]!.type).toBe('assistant')
  })

  test('preserves message order', async () => {
    const { normalizeMessagesForAPI } = await import(MODULE_PATH)
    const u1 = makeUser('q1')
    const a1 = makeAssistant('a1')
    const u2 = makeUser('q2')
    const a2 = makeAssistant('a2')

    const result = normalizeMessagesForAPI([u1, a1, u2, a2])
    expect(result[0]).toEqual(u1)
    expect(result[1]).toBe(a1)
    expect(result[2]).toEqual(u2)
    expect(result[3]).toBe(a2)
  })
})
