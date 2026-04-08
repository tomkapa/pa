import { describe, test, expect } from 'bun:test'
import {
  detectEffortLevel,
  budgetTokensFor,
  buildThinkingConfig,
  type EffortLevel,
} from '../services/agent/thinking.js'

describe('detectEffortLevel', () => {
  test('returns "off" for messages with no keyword', () => {
    expect(detectEffortLevel('hello world')).toBe('off')
    expect(detectEffortLevel('')).toBe('off')
    expect(detectEffortLevel('please debug this code')).toBe('off')
  })

  test('detects each keyword and maps to the right level', () => {
    expect(detectEffortLevel('think about this')).toBe('low')
    expect(detectEffortLevel('think hard about it')).toBe('medium')
    expect(detectEffortLevel('think harder about edge cases')).toBe('high')
    expect(detectEffortLevel('ultrathink the architecture')).toBe('max')
  })

  test('is case-insensitive', () => {
    expect(detectEffortLevel('Think about this')).toBe('low')
    expect(detectEffortLevel('THINK HARD')).toBe('medium')
    expect(detectEffortLevel('Think Harder please')).toBe('high')
    expect(detectEffortLevel('UltraThink')).toBe('max')
  })

  test('longest matching keyword wins (think harder beats think)', () => {
    // If walked in the wrong order, "think harder" would be classified as
    // "low" because the bare /\bthink\b/ would also match. The detector
    // walks longest-first, so it should land on "high".
    expect(detectEffortLevel('think harder about this')).toBe('high')
    expect(detectEffortLevel('please think hard before answering')).toBe('medium')
  })

  test('substring false-positives do NOT trigger thinking', () => {
    // The whole point of word-boundary regex.
    expect(detectEffortLevel("I'll rethink this later")).toBe('off')
    expect(detectEffortLevel('overthinking is a problem')).toBe('off')
    expect(detectEffortLevel('thinkpad keyboards rule')).toBe('off')
    expect(detectEffortLevel('unthinkable consequences')).toBe('off')
  })

  test('keyword embedded in surrounding text still wins', () => {
    expect(detectEffortLevel('Hey, please think about this and let me know'))
      .toBe('low')
    expect(detectEffortLevel('Before you answer: ultrathink the algorithm.'))
      .toBe('max')
  })
})

describe('budgetTokensFor', () => {
  test('off → 0', () => {
    expect(budgetTokensFor('off')).toBe(0)
  })

  test('budgets are monotonically increasing', () => {
    const order: EffortLevel[] = ['off', 'low', 'medium', 'high']
    let prev = -1
    for (const level of order) {
      const b = budgetTokensFor(level)
      expect(b).toBeGreaterThanOrEqual(prev)
      prev = b
    }
  })

  test('max ≥ high (max may be the same or larger)', () => {
    expect(budgetTokensFor('max')).toBeGreaterThanOrEqual(budgetTokensFor('high'))
  })
})

describe('buildThinkingConfig', () => {
  test('returns undefined for "off"', () => {
    expect(buildThinkingConfig('off', 40_000)).toBeUndefined()
  })

  test('returns enabled config with the budget for "low"', () => {
    const cfg = buildThinkingConfig('low', 40_000)
    expect(cfg).toEqual({ type: 'enabled', budget_tokens: 4_000 })
  })

  test('clamps budget to max_tokens - 1', () => {
    // max effort wants 31_999 but max_tokens is small.
    const cfg = buildThinkingConfig('max', 5_000)
    expect(cfg).toEqual({ type: 'enabled', budget_tokens: 4_999 })
  })

  test('returns undefined when clamped budget would be below the API minimum (1024)', () => {
    // If max_tokens is small enough that the clamp drops below 1024, the
    // request would be rejected — better to omit thinking entirely.
    expect(buildThinkingConfig('max', 1024)).toBeUndefined()
    expect(buildThinkingConfig('low', 500)).toBeUndefined()
  })

  test('always satisfies budget_tokens < max_tokens', () => {
    for (const level of ['low', 'medium', 'high', 'max'] as const) {
      for (const max of [2_000, 8_000, 40_000, 100_000]) {
        const cfg = buildThinkingConfig(level, max)
        if (cfg && cfg.type === 'enabled') {
          expect(cfg.budget_tokens).toBeLessThan(max)
          expect(cfg.budget_tokens).toBeGreaterThanOrEqual(1024)
        }
      }
    }
  })
})
