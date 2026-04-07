// ---------------------------------------------------------------------------
// Section Registry
//
// Dynamic sections (memory, env info, language, MCP instructions, ...) are
// registered through small factory helpers — `cachedSection` and
// `uncachedSection` — and resolved together by `resolveSections`.
//
// The cache is keyed by section `name` and lives for a single session
// (until `resetSectionCache()` is called by `/clear` or `/compact`). This
// matches the natural cache lifetime of the prompt: the static prefix is
// cached for everyone, the dynamic suffix is cached per session, and the
// only way a session-cached section gets recomputed mid-session is if its
// builder explicitly opts into `cacheBreak`.
//
// `cacheBreak: true` requires a `reason` because each break degrades
// prompt caching. The reason is documentation, not validation — it just
// forces the author to write down *why* the cost is acceptable.
// ---------------------------------------------------------------------------

import type { ResolvedSection, Section } from './types.js'

/**
 * Per-session cache. Keys are section names. Values are the resolved
 * content (`string` or `null` for opt-out). Cleared by `/clear` or
 * `/compact` via `resetSectionCache()`.
 */
const sectionCache = new Map<string, string | null>()

/**
 * Drop all cached section values. Call this when the conversation is
 * cleared or compacted — both events change the implicit cache key
 * (different message history, possibly different model).
 */
export function resetSectionCache(): void {
  sectionCache.clear()
}

/** Read-only view for tests. */
export function getCachedSectionNames(): string[] {
  return Array.from(sectionCache.keys())
}

/**
 * Build a section that is computed at most once per session. Subsequent
 * resolves return the cached value without invoking `compute`.
 */
export function cachedSection(
  name: string,
  compute: Section['compute'],
): Section {
  return { name, compute, cacheBreak: false }
}

/**
 * Build a section that is recomputed every turn. **Every uncached section
 * busts prompt caching for the dynamic zone**, so the `reason` parameter
 * is required and should be specific (e.g. "MCP servers connect/disconnect
 * between turns" — not "dynamic data").
 */
export function uncachedSection(
  name: string,
  compute: Section['compute'],
  reason: string,
): Section {
  if (!reason || reason.trim().length === 0) {
    throw new Error(
      `uncachedSection("${name}") requires a non-empty reason — every cache-break degrades prompt caching`,
    )
  }
  return { name, compute, cacheBreak: true, reason }
}

async function resolveOne(section: Section): Promise<ResolvedSection> {
  const fromCache = !section.cacheBreak && sectionCache.has(section.name)
  const value = fromCache
    ? (sectionCache.get(section.name) ?? null)
    : await section.compute()
  if (!section.cacheBreak && !fromCache) {
    sectionCache.set(section.name, value)
  }
  return { name: section.name, value, fromCache }
}

/**
 * Diagnostic variant — returns the resolved value AND whether each one
 * came from the cache. Used by tests and the `/debug` slash command,
 * never on the hot path.
 */
export async function resolveSectionsDetailed(
  sections: Section[],
): Promise<ResolvedSection[]> {
  return Promise.all(sections.map(resolveOne))
}

/**
 * Resolve every section in `sections`, returning their values in the same
 * order. Cached sections are read from the per-session cache when present;
 * uncached sections always recompute. Resolution runs in parallel because
 * builders may do I/O (read files, query subprocesses, etc.).
 *
 * Errors thrown by a `compute` function bubble up — callers should wrap
 * resolution in their own error handling rather than swallow per-section
 * failures (per project rule: don't swallow errors).
 */
export async function resolveSections(
  sections: Section[],
): Promise<Array<string | null>> {
  const detailed = await resolveSectionsDetailed(sections)
  return detailed.map(d => d.value)
}
