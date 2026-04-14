import { describe, test, expect } from 'bun:test'
import {
  isValidAgentName,
  AGENT_NAME_MIN_LENGTH,
  AGENT_NAME_MAX_LENGTH,
} from '../../services/agents/types.js'

describe('isValidAgentName', () => {
  test('accepts valid names', () => {
    expect(isValidAgentName('code-reviewer')).toBe(true)
    expect(isValidAgentName('Explore')).toBe(true)
    expect(isValidAgentName('my-agent-123')).toBe(true)
    expect(isValidAgentName('abc')).toBe(true) // minimum 3 chars
    expect(isValidAgentName('A1B')).toBe(true)
  })

  test('rejects names that start with a hyphen', () => {
    expect(isValidAgentName('-reader')).toBe(false)
  })

  test('rejects names that end with a hyphen', () => {
    expect(isValidAgentName('reader-')).toBe(false)
  })

  test('rejects names shorter than minimum', () => {
    expect(isValidAgentName('ab')).toBe(false)
    expect(isValidAgentName('a')).toBe(false)
    expect(isValidAgentName('')).toBe(false)
  })

  test('rejects names longer than maximum', () => {
    const longName = 'a' + 'b'.repeat(AGENT_NAME_MAX_LENGTH - 1) + 'c'
    expect(longName.length).toBeGreaterThan(AGENT_NAME_MAX_LENGTH)
    expect(isValidAgentName(longName)).toBe(false)
  })

  test('rejects names with special characters', () => {
    expect(isValidAgentName('code_reviewer')).toBe(false)  // underscore
    expect(isValidAgentName('code.reviewer')).toBe(false)  // dot
    expect(isValidAgentName('code reviewer')).toBe(false)  // space
    expect(isValidAgentName('code/reviewer')).toBe(false)  // slash
  })

  test('minimum length is 3', () => {
    expect(AGENT_NAME_MIN_LENGTH).toBe(3)
  })

  test('maximum length is 50', () => {
    expect(AGENT_NAME_MAX_LENGTH).toBe(50)
  })
})
