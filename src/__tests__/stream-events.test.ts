import { describe, test, expect } from 'bun:test'
import { emptyUsage, mergeUsage, type TokenUsage } from '../types/streamEvents.js'

describe('emptyUsage', () => {
  test('returns all zeros', () => {
    const usage = emptyUsage()
    expect(usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    })
  })
})

describe('mergeUsage', () => {
  const base: TokenUsage = {
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 20,
  }

  test('updates fields with positive values', () => {
    const result = mergeUsage(base, {
      input_tokens: 200,
      output_tokens: 80,
      cache_creation_input_tokens: 15,
      cache_read_input_tokens: 30,
    })
    expect(result).toEqual({
      inputTokens: 200,
      outputTokens: 80,
      cacheCreationInputTokens: 15,
      cacheReadInputTokens: 30,
    })
  })

  test('keeps base values when update has zeros', () => {
    const result = mergeUsage(base, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    })
    expect(result).toEqual(base)
  })

  test('keeps base values when update has nulls', () => {
    const result = mergeUsage(base, {
      input_tokens: null,
      output_tokens: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
    } as unknown as Parameters<typeof mergeUsage>[1])
    expect(result).toEqual(base)
  })

  test('partially updates — only overrides positive values', () => {
    const result = mergeUsage(base, {
      input_tokens: 0,
      output_tokens: 75,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
    } as Parameters<typeof mergeUsage>[1])
    expect(result).toEqual({
      inputTokens: 100,
      outputTokens: 75,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 20,
    })
  })
})
