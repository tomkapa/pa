import { describe, test, expect } from 'bun:test'
import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage, Message } from '../types/message.js'
import { normalizeMessagesForAPI, sortAssistantContent } from '../services/messages/normalize.js'

function thinkingBlock(text: string): ContentBlock {
  return { type: 'thinking', thinking: text, signature: '' } as ContentBlock
}

function textBlock(text: string): ContentBlock {
  return { type: 'text', text, citations: null } as ContentBlock
}

function toolUseBlock(id = 'toolu_x'): ContentBlock {
  return {
    type: 'tool_use',
    id,
    name: 'read_file',
    input: {},
    caller: { type: 'direct' },
  } as ContentBlock
}

function makeAssistant(content: ContentBlock[]): AssistantMessage {
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

describe('sortAssistantContent', () => {
  test('preserves identity when there is no thinking block', () => {
    const content: ContentBlock[] = [textBlock('hello'), toolUseBlock()]
    const sorted = sortAssistantContent(content)
    expect(sorted).toBe(content)
  })

  test('preserves identity when thinking already comes first', () => {
    const content: ContentBlock[] = [
      thinkingBlock('reasoning'),
      textBlock('answer'),
      toolUseBlock(),
    ]
    const sorted = sortAssistantContent(content)
    expect(sorted).toBe(content)
  })

  test('moves a misordered thinking block to the front', () => {
    const t = thinkingBlock('reasoning')
    const text = textBlock('answer')
    const tool = toolUseBlock()
    const sorted = sortAssistantContent([text, t, tool])
    expect(sorted).not.toBe([])
    expect(sorted[0]).toBe(t)
    // Non-thinking blocks keep their relative order
    expect(sorted[1]).toBe(text)
    expect(sorted[2]).toBe(tool)
  })

  test('handles multiple thinking blocks interleaved', () => {
    const t1 = thinkingBlock('first thought')
    const t2 = thinkingBlock('second thought')
    const text = textBlock('hi')
    const tool = toolUseBlock()
    const sorted = sortAssistantContent([text, t1, tool, t2])
    expect(sorted[0]).toBe(t1)
    expect(sorted[1]).toBe(t2)
    expect(sorted[2]).toBe(text)
    expect(sorted[3]).toBe(tool)
  })
})

describe('normalizeMessagesForAPI thinking ordering', () => {
  test('rewrites assistant messages to put thinking blocks first', () => {
    const t = thinkingBlock('reasoning')
    const text = textBlock('answer')
    const messages: Message[] = [makeAssistant([text, t])]

    const result = normalizeMessagesForAPI(messages)
    expect(result).toHaveLength(1)
    const out = result[0]!
    expect(out.type).toBe('assistant')
    if (out.type !== 'assistant') return
    const blocks = out.message.content as ContentBlock[]
    expect(blocks[0]!.type).toBe('thinking')
    expect(blocks[1]!.type).toBe('text')
  })

  test('passes through correctly-ordered assistant messages unchanged', () => {
    const original = makeAssistant([thinkingBlock('r'), textBlock('a')])
    const result = normalizeMessagesForAPI([original])
    expect(result[0]).toBe(original)
  })
})
