import { describe, test, expect } from 'bun:test'
import { sanitizeName, buildAgentId } from '../services/teams/paths.js'

describe('sanitizeName', () => {
  test('lowercases letters', () => {
    expect(sanitizeName('HelloTeam')).toBe('helloteam')
  })

  test('replaces whitespace and underscores with hyphens', () => {
    expect(sanitizeName('my team  name_two')).toBe('my-team-name-two')
  })

  test('strips special characters', () => {
    expect(sanitizeName('ops/prod#1')).toBe('opsprod1')
  })

  test('collapses adjacent hyphens and trims ends', () => {
    expect(sanitizeName('--ops---team--')).toBe('ops-team')
  })

  test('falls back to "unnamed" on empty input', () => {
    expect(sanitizeName('')).toBe('unnamed')
    expect(sanitizeName('   ')).toBe('unnamed')
    expect(sanitizeName('!!!')).toBe('unnamed')
  })
})

describe('buildAgentId', () => {
  test('joins sanitized name and team with @', () => {
    expect(buildAgentId('Researcher', 'My Team')).toBe('researcher@my-team')
  })
})
