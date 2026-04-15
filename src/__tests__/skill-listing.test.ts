import { describe, test, expect, beforeEach } from 'bun:test'
import {
  formatCommandsWithinBudget,
  getCharBudget,
  type SkillListingEntry,
} from '../services/skills/listing.js'
import { clearInvokedSkills, addInvokedSkill } from '../services/skills/invocation-tracking.js'

function makeEntry(overrides: Partial<SkillListingEntry> = {}): SkillListingEntry {
  return {
    name: 'test-skill',
    description: 'A test skill',
    whenToUse: undefined,
    ...overrides,
  }
}

describe('getCharBudget', () => {
  test('returns 1% of context window in chars', () => {
    // 200K tokens * 4 chars/token * 0.01 = 8000
    expect(getCharBudget(200_000)).toBe(8_000)
  })

  test('returns 1% for 1M context', () => {
    // 1M tokens * 4 chars/token * 0.01 = 40000
    expect(getCharBudget(1_000_000)).toBe(40_000)
  })

  test('returns fallback for undefined', () => {
    expect(getCharBudget(undefined)).toBe(8_000)
  })
})

describe('formatCommandsWithinBudget', () => {
  beforeEach(() => {
    clearInvokedSkills()
  })

  test('formats single skill with description', () => {
    const entries = [makeEntry({ name: 'commit', description: 'Create a git commit' })]
    const result = formatCommandsWithinBudget(entries)
    expect(result).toContain('- commit: Create a git commit')
  })

  test('formats skill with whenToUse', () => {
    const entries = [
      makeEntry({
        name: 'review-pr',
        description: 'Review a PR',
        whenToUse: 'When user mentions "review" or provides a PR number',
      }),
    ]
    const result = formatCommandsWithinBudget(entries)
    expect(result).toContain('- review-pr: Review a PR')
    expect(result).toContain('When user mentions "review"')
  })

  test('returns null when no entries', () => {
    const result = formatCommandsWithinBudget([])
    expect(result).toBeNull()
  })

  test('excludes invoked skills', () => {
    addInvokedSkill('already-used')
    const entries = [
      makeEntry({ name: 'already-used', description: 'Used' }),
      makeEntry({ name: 'not-used', description: 'Not used' }),
    ]
    const result = formatCommandsWithinBudget(entries)
    expect(result).not.toContain('already-used')
    expect(result).toContain('not-used')
  })

  test('returns null when all skills are invoked', () => {
    addInvokedSkill('only-one')
    const entries = [makeEntry({ name: 'only-one', description: 'Only skill' })]
    const result = formatCommandsWithinBudget(entries)
    expect(result).toBeNull()
  })

  test('truncates descriptions when over budget', () => {
    // Create many skills with long descriptions
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        name: `skill-${i}`,
        description: 'A'.repeat(200),
        whenToUse: 'B'.repeat(200),
      }),
    )
    // Full listing: 10 entries * ~260 chars each = ~2600 chars
    // Budget at 10K tokens = 10000 * 4 * 0.01 = 400 chars — forces truncation
    const fullResult = formatCommandsWithinBudget(entries)
    const truncatedResult = formatCommandsWithinBudget(entries, 10_000)
    expect(truncatedResult).not.toBeNull()
    // Truncated should be shorter than full
    expect(truncatedResult!.length).toBeLessThan(fullResult!.length)
    // All skill names should still be present
    const lines = truncatedResult!.split('\n').filter(l => l.startsWith('- skill-'))
    expect(lines).toHaveLength(10)
  })

  test('falls back to names-only when budget is very tight', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({
        name: `skill-${i}`,
        description: 'A'.repeat(100),
      }),
    )
    // Very tiny budget — should fall back to names only
    const result = formatCommandsWithinBudget(entries, 100)
    expect(result).not.toBeNull()
    // Should contain skill names but minimal descriptions
    expect(result).toContain('skill-0')
  })

  test('handles multiple skills within budget', () => {
    const entries = [
      makeEntry({ name: 'commit', description: 'Create a commit' }),
      makeEntry({ name: 'review', description: 'Review code' }),
      makeEntry({ name: 'deploy', description: 'Deploy app' }),
    ]
    const result = formatCommandsWithinBudget(entries)
    expect(result).toContain('commit')
    expect(result).toContain('review')
    expect(result).toContain('deploy')
  })

  test('caps individual entry at 250 chars', () => {
    const entries = [
      makeEntry({
        name: 'verbose',
        description: 'D'.repeat(300),
        whenToUse: 'W'.repeat(300),
      }),
    ]
    const result = formatCommandsWithinBudget(entries)
    // The entry line should be capped
    const lines = result!.split('\n').filter(l => l.startsWith('- verbose'))
    expect(lines).toHaveLength(1)
    // Total entry (excluding "- verbose: " prefix) should be <= 250
    const entryContent = lines[0]!.slice('- verbose: '.length)
    expect(entryContent.length).toBeLessThanOrEqual(250)
  })
})
