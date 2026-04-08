import type { ThinkingConfigParam } from '@anthropic-ai/sdk/resources/messages/messages'

/**
 * Extended-thinking effort levels.
 *
 * The user opts in via a magic keyword in their message; the keyword maps to
 * an effort level, the effort level maps to a `budget_tokens` value, and that
 * value becomes the `thinking` field on the next API request. See
 * `detectEffortLevel` for the keyword grammar.
 */
export type EffortLevel = 'off' | 'low' | 'medium' | 'high' | 'max'

/**
 * Token budget per effort level. Numbers chosen to roughly match the
 * classic Claude Code defaults — small enough that "low" stays cheap, large
 * enough that "max" actually changes the answer on hard problems.
 */
const EFFORT_BUDGET: Record<EffortLevel, number> = {
  off: 0,
  low: 4_000,
  medium: 10_000,
  high: 31_999,
  max: 31_999,
}

/**
 * Keyword → effort mapping. Order matters: longer keywords are checked first
 * so `\bthink\b` (which would otherwise match the word "think" inside "think
 * harder") doesn't down-classify a higher-effort request.
 *
 * `\b` boundaries prevent substring false-positives like "rethink",
 * "overthinking", or "thinkpad".
 */
const KEYWORD_RULES: ReadonlyArray<readonly [RegExp, EffortLevel]> = [
  [/\bultrathink\b/i, 'max'],
  [/\bthink\s+harder\b/i, 'high'],
  [/\bthink\s+hard\b/i, 'medium'],
  [/\bthink\b/i, 'low'],
]

/**
 * Scan a user message for an extended-thinking keyword and return the
 * corresponding effort level. Returns `'off'` when no keyword is present.
 *
 * The keyword is intentionally NOT stripped from the message — it's useful
 * context for the model on top of being a control signal, and stripping
 * would force callers to track edit offsets.
 */
export function detectEffortLevel(userInput: string): EffortLevel {
  for (const [rx, level] of KEYWORD_RULES) {
    if (rx.test(userInput)) return level
  }
  return 'off'
}

/**
 * Look up the raw budget for an effort level. Use `buildThinkingConfig` if
 * you want a request-ready `thinking` payload (with the `< max_tokens`
 * constraint enforced).
 */
export function budgetTokensFor(level: EffortLevel): number {
  return EFFORT_BUDGET[level]
}

/**
 * Build the `thinking` field for a Messages API request. Returns `undefined`
 * for `'off'` so callers can spread it conditionally without polluting the
 * payload with a disabled config.
 *
 * Enforces the API constraint `budget_tokens < max_tokens` by clamping. The
 * Anthropic SDK rejects requests where `budget_tokens >= max_tokens` with a
 * 400, so this is a hard requirement, not a hint.
 */
export function buildThinkingConfig(
  level: EffortLevel,
  maxTokens: number,
): ThinkingConfigParam | undefined {
  const budget = budgetTokensFor(level)
  if (budget <= 0) return undefined

  // The API also requires budget >= 1024 — if a caller picks a custom level
  // below the floor we'd rather not send than send a request that 400s.
  const clamped = Math.min(budget, Math.max(0, maxTokens - 1))
  if (clamped < 1024) return undefined

  return { type: 'enabled', budget_tokens: clamped }
}
