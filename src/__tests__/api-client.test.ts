import { describe, test, expect } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicClient } from '../services/api/client.js'

describe('createAnthropicClient', () => {
  test('returns an Anthropic client instance', () => {
    const client = createAnthropicClient({ apiKey: 'test-key' })
    expect(client).toBeInstanceOf(Anthropic)
  })

  test('uses provided apiKey', () => {
    const client = createAnthropicClient({ apiKey: 'sk-test-123' })
    expect(client.apiKey).toBe('sk-test-123')
  })

  test('uses default maxRetries of 2', () => {
    const client = createAnthropicClient({ apiKey: 'test-key' })
    expect(client.maxRetries).toBe(2)
  })

  test('respects custom maxRetries', () => {
    const client = createAnthropicClient({ apiKey: 'test-key', maxRetries: 5 })
    expect(client.maxRetries).toBe(5)
  })

  test('uses default timeout of 600000ms', () => {
    const client = createAnthropicClient({ apiKey: 'test-key' })
    expect(client.timeout).toBe(600_000)
  })

  test('respects custom timeout', () => {
    const client = createAnthropicClient({ apiKey: 'test-key', timeoutMs: 30_000 })
    expect(client.timeout).toBe(30_000)
  })
})
