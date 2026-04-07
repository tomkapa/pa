import { describe, expect, test } from 'bun:test'
import { systemPromptToBlocks } from '../services/agent/deps.js'
import { DYNAMIC_BOUNDARY } from '../services/system-prompt/index.js'

describe('systemPromptToBlocks', () => {
  test('maps each surviving section to a text block', () => {
    const blocks = systemPromptToBlocks(['You are an assistant.', 'Be helpful.'])
    expect(blocks).toEqual([
      { type: 'text', text: 'You are an assistant.' },
      { type: 'text', text: 'Be helpful.' },
    ])
  })

  test('strips the dynamic boundary marker', () => {
    const blocks = systemPromptToBlocks([
      'static-1',
      'static-2',
      DYNAMIC_BOUNDARY,
      'dynamic-1',
    ])
    expect(blocks.map(b => b.text)).toEqual(['static-1', 'static-2', 'dynamic-1'])
  })

  test('drops empty sections', () => {
    const blocks = systemPromptToBlocks(['kept', '', 'also-kept'])
    expect(blocks.map(b => b.text)).toEqual(['kept', 'also-kept'])
  })

  test('returns an empty array for an empty prompt', () => {
    expect(systemPromptToBlocks([])).toEqual([])
  })

  test('returns an empty array when the prompt is only the boundary', () => {
    expect(systemPromptToBlocks([DYNAMIC_BOUNDARY])).toEqual([])
  })
})
