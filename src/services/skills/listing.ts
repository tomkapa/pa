import { hasSkillBeenInvoked } from './invocation-tracking.js'

/**
 * Minimal entry shape for the budget-controlled listing. Avoids
 * coupling to the full RegisteredCustomCommand type.
 */
export interface SkillListingEntry {
  name: string
  description?: string
  whenToUse?: string
}

/**
 * Max characters for a single skill's combined description + whenToUse.
 * Prevents one verbose skill from dominating the listing.
 */
const MAX_ENTRY_CHARS = 250

/**
 * Compute the character budget for the skill listing based on context
 * window size. Defaults to ~1% of a 200K context (8,000 chars).
 */
export function getCharBudget(contextWindowTokens?: number): number {
  if (contextWindowTokens) {
    return Math.floor(contextWindowTokens * 4 * 0.01)
  }
  return 8_000
}

/**
 * Format a skill entry line. Combines description and whenToUse,
 * capped at `maxDescLen` characters for the descriptive part.
 */
function formatEntry(entry: SkillListingEntry, maxDescLen: number): string {
  let desc = entry.description ?? ''
  if (entry.whenToUse) {
    desc = desc ? `${desc} ${entry.whenToUse}` : entry.whenToUse
  }
  if (desc.length > maxDescLen) {
    desc = desc.slice(0, maxDescLen - 1) + '\u2026'
  }
  return desc ? `- ${entry.name}: ${desc}` : `- ${entry.name}`
}

/**
 * Format skill/command listings within a token budget.
 *
 * Strategy:
 *   1. Filter out already-invoked skills
 *   2. Try full descriptions (capped at MAX_ENTRY_CHARS each)
 *   3. If over budget, progressively truncate descriptions
 *   4. If truncation below 20 chars, fall back to names-only
 *
 * Returns `null` when there are no entries to show.
 */
export function formatCommandsWithinBudget(
  entries: ReadonlyArray<SkillListingEntry>,
  contextWindowTokens?: number,
): string | null {
  // Filter out already-invoked skills
  const filtered = entries.filter(e => !hasSkillBeenInvoked(e.name))
  if (filtered.length === 0) return null

  const budget = getCharBudget(contextWindowTokens)

  // Try full descriptions first (each capped at MAX_ENTRY_CHARS)
  const fullLines = filtered.map(e => formatEntry(e, MAX_ENTRY_CHARS))
  const fullText = fullLines.join('\n')
  if (fullText.length <= budget) return fullText

  // Over budget — compute max description length that fits
  // Each line is: "- name: desc\n" → overhead = 4 + name.length + 2
  const totalOverhead = filtered.reduce(
    (sum, e) => sum + `- ${e.name}: `.length + 1, // +1 for newline
    0,
  )
  const availableForDesc = budget - totalOverhead
  const maxDescLen = Math.max(
    0,
    Math.floor(availableForDesc / filtered.length),
  )

  if (maxDescLen < 20) {
    // Fall back to names-only
    const namesOnly = filtered.map(e => `- ${e.name}`).join('\n')
    return namesOnly
  }

  const truncatedLines = filtered.map(e => formatEntry(e, maxDescLen))
  return truncatedLines.join('\n')
}
