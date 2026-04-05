import { describe, test, expect, mock } from 'bun:test'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { UserMessage, AssistantMessage, SystemMessage } from '../types/message.js'

// Will import from implementation once created
const MODULE_PATH = '../services/messages/factory.js'

describe('createUserMessage', () => {
  test('generates uuid and timestamp', async () => {
    const { createUserMessage } = await import(MODULE_PATH)
    const msg: UserMessage = createUserMessage({ content: 'hello' })

    expect(msg.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(msg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(msg.type).toBe('user')
    expect(msg.message.role).toBe('user')
  })

  test('normalizes string content to ContentBlockParam array', async () => {
    const { createUserMessage } = await import(MODULE_PATH)
    const msg: UserMessage = createUserMessage({ content: 'hello' })

    expect(msg.message.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  test('replaces empty string content with placeholder', async () => {
    const { createUserMessage } = await import(MODULE_PATH)
    const msg: UserMessage = createUserMessage({ content: '' })

    expect(msg.message.content).toEqual([{ type: 'text', text: '(no content)' }])
  })

  test('preserves ContentBlockParam array content as-is', async () => {
    const { createUserMessage } = await import(MODULE_PATH)
    const blocks: ContentBlockParam[] = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]
    const msg: UserMessage = createUserMessage({ content: blocks })

    expect(msg.message.content).toEqual(blocks)
  })

  test('sets isMeta flag when provided', async () => {
    const { createUserMessage } = await import(MODULE_PATH)
    const msg: UserMessage = createUserMessage({ content: 'hook output', isMeta: true })

    expect(msg.isMeta).toBe(true)
  })

  test('sets toolUseResult and sourceToolAssistantUUID', async () => {
    const { createUserMessage } = await import(MODULE_PATH)
    const toolResult = { type: 'tool_result', tool_use_id: 'tu_123', content: 'result' }
    const msg: UserMessage = createUserMessage({
      content: [{ type: 'tool_result', tool_use_id: 'tu_123', content: 'result' }],
      toolUseResult: toolResult,
      sourceToolAssistantUUID: 'asst-uuid-456',
    })

    expect(msg.toolUseResult).toEqual(toolResult)
    expect(msg.sourceToolAssistantUUID).toBe('asst-uuid-456')
  })

  test('omits optional fields when not provided', async () => {
    const { createUserMessage } = await import(MODULE_PATH)
    const msg: UserMessage = createUserMessage({ content: 'plain' })

    expect(msg.isMeta).toBeUndefined()
    expect(msg.toolUseResult).toBeUndefined()
    expect(msg.sourceToolAssistantUUID).toBeUndefined()
  })
})

describe('createAssistantMessage', () => {
  const fakeApiResponse = {
    id: 'msg_abc',
    type: 'message' as const,
    role: 'assistant' as const,
    model: 'claude-sonnet-4-20250514',
    content: [{ type: 'text' as const, text: 'Hello!', citations: null }],
    stop_reason: 'end_turn' as const,
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
  }

  test('generates uuid and timestamp', async () => {
    const { createAssistantMessage } = await import(MODULE_PATH)
    const msg: AssistantMessage = createAssistantMessage({
      apiResponse: fakeApiResponse,
    })

    expect(msg.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(msg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(msg.type).toBe('assistant')
  })

  test('wraps the raw API response in message field', async () => {
    const { createAssistantMessage } = await import(MODULE_PATH)
    const msg: AssistantMessage = createAssistantMessage({
      apiResponse: fakeApiResponse,
    })

    expect(msg.message).toBe(fakeApiResponse)
    expect(msg.message.role).toBe('assistant')
    expect(msg.message.model).toBe('claude-sonnet-4-20250514')
  })

  test('stores requestId', async () => {
    const { createAssistantMessage } = await import(MODULE_PATH)
    const msg: AssistantMessage = createAssistantMessage({
      apiResponse: fakeApiResponse,
      requestId: 'req_xyz',
    })

    expect(msg.requestId).toBe('req_xyz')
  })

  test('requestId defaults to undefined', async () => {
    const { createAssistantMessage } = await import(MODULE_PATH)
    const msg: AssistantMessage = createAssistantMessage({
      apiResponse: fakeApiResponse,
    })

    expect(msg.requestId).toBeUndefined()
  })
})

describe('createSystemMessage', () => {
  test('generates uuid and timestamp', async () => {
    const { createSystemMessage } = await import(MODULE_PATH)
    const msg: SystemMessage = createSystemMessage({
      subtype: 'informational',
      content: 'Something happened',
      level: 'info',
    })

    expect(msg.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(msg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(msg.type).toBe('system')
  })

  test('sets subtype, content, and level', async () => {
    const { createSystemMessage } = await import(MODULE_PATH)
    const msg: SystemMessage = createSystemMessage({
      subtype: 'turn_duration',
      content: 'Turn took 3.2s',
      level: 'info',
    })

    expect(msg.subtype).toBe('turn_duration')
    expect(msg.content).toBe('Turn took 3.2s')
    expect(msg.level).toBe('info')
  })

  test('supports all level values', async () => {
    const { createSystemMessage } = await import(MODULE_PATH)

    for (const level of ['info', 'warning', 'error'] as const) {
      const msg: SystemMessage = createSystemMessage({
        subtype: 'informational',
        content: `Level: ${level}`,
        level,
      })
      expect(msg.level).toBe(level)
    }
  })
})
