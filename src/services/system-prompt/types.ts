// ---------------------------------------------------------------------------
// System Prompt Types
//
// The system prompt is a `string[]` (an array of independent sections), not
// a single joined string. Each section is one block of instructions. They
// are joined with `\n\n` when sent to the API.
//
// We split the array into two zones with a sentinel marker:
//   - the STATIC zone (rarely changes — cacheable for the whole user base)
//   - the DYNAMIC zone (changes per session/turn — cacheable per session)
//
// The API layer is expected to split on `DYNAMIC_BOUNDARY` and apply
// different `cache_control` headers to each side.
// ---------------------------------------------------------------------------

/**
 * Sentinel string inserted between the static and dynamic zones of the
 * assembled prompt. Callers downstream (the API layer) split the array on
 * this marker to apply distinct cache headers to each zone.
 *
 * Kept distinctive enough to never collide with real prompt text.
 */
export const DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'

/**
 * A dynamic section in the registry. Each section has:
 *   - a stable `name` used for caching across calls
 *   - a `compute` function that produces its content (or `null` to skip)
 *   - a `cacheBreak` flag — when `true`, the section is recomputed every
 *     turn instead of being read from the per-session cache
 *   - a `reason` (required when `cacheBreak: true`) documenting *why* the
 *     section bypasses caching, since every cache-break degrades prompt
 *     caching for the whole conversation
 */
export interface Section {
  name: string
  compute: () => string | null | Promise<string | null>
  cacheBreak: boolean
  /** Required when `cacheBreak: true` — explains why the cache bypass exists. */
  reason?: string
}

/**
 * Resolved view of a single section after `resolveSections` has been run.
 * Used by tests and tooling that want to inspect what each registry slot
 * produced for a given turn.
 */
export interface ResolvedSection {
  name: string
  value: string | null
  fromCache: boolean
}

/**
 * Inputs to `buildEffectiveSystemPrompt` — the priority-based selector that
 * picks which prompt the API call should use. Highest priority wins:
 *
 *   1. `overrideSystemPrompt` — replaces everything (loop / one-shot mode)
 *   2. `agentSystemPrompt`    — set when running as a subagent
 *   3. `customSystemPrompt`   — user-provided via `--system-prompt` flag
 *   4. `defaultSystemPrompt`  — the full standard prompt
 *
 * `appendSystemPrompt` is concatenated at the end except when
 * `overrideSystemPrompt` is set (override fully replaces).
 */
export interface EffectiveSystemPromptInputs {
  defaultSystemPrompt: string[]
  customSystemPrompt?: string
  agentSystemPrompt?: string
  overrideSystemPrompt?: string | null
  appendSystemPrompt?: string
}

/**
 * The two context bundles that travel alongside the system prompt but are
 * NOT included in it. The API layer attaches them as additional cached
 * blocks so they don't bust the global static-prompt cache.
 *
 * - `userContext`   — per-project: CLAUDE.md content + current date
 * - `systemContext` — per-checkout: git status snapshot
 */
export interface UserContext {
  /** Concatenated CLAUDE.md hierarchy formatted for prompt injection. */
  claudeMd?: string
  /** ISO date the conversation started — `YYYY-MM-DD`. */
  currentDate: string
}

export interface SystemContext {
  /** Pre-formatted git status block, or `undefined` outside a repo. */
  gitStatus?: string
}
