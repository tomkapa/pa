import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getConfigHomeDir } from '../session/paths.js'
import {
  HooksSettingsSchema,
  type HookEvent,
  type HookMatcher,
} from './types.js'

// ---------------------------------------------------------------------------
// Config Loading — read hooks from user + project settings.json
// ---------------------------------------------------------------------------

/**
 * Load hook matchers for a specific event from both user-level and
 * project-level settings. Both sources' hooks fire (concatenated).
 */
export function getHooksForEvent(event: HookEvent): HookMatcher[] {
  const userHooks = loadHooksFromFile(getUserSettingsPath())
  const projectHooks = loadHooksFromFile(getProjectSettingsPath())

  const userEventHooks = userHooks?.[event] ?? []
  const projectEventHooks = projectHooks?.[event] ?? []

  return [...userEventHooks, ...projectEventHooks]
}

/**
 * Filter matcher groups by a match query. A matcher group fires when:
 * - Its `matcher` field is undefined/empty (wildcard — fires for all), OR
 * - Its `matcher` field exactly equals the query string
 */
export function filterByMatcher(
  matchers: HookMatcher[],
  matchQuery?: string,
): HookMatcher[] {
  if (!matchQuery) return matchers
  return matchers.filter(m => !m.matcher || m.matcher === matchQuery)
}

// ---------------------------------------------------------------------------
// Settings file paths
// ---------------------------------------------------------------------------

export function getUserSettingsPath(): string {
  return join(getConfigHomeDir(), 'settings.json')
}

export function getProjectSettingsPath(): string {
  return join(process.cwd(), '.pa', 'settings.json')
}

// ---------------------------------------------------------------------------
// Mtime-based cache — avoids re-reading files on every tool call
// ---------------------------------------------------------------------------

interface CacheEntry {
  mtimeMs: number
  data: Record<string, HookMatcher[]> | undefined
}

const fileCache = new Map<string, CacheEntry>()

/** Exposed for tests that need to reset cached state between runs. */
export function clearHooksConfigCache(): void {
  fileCache.clear()
}

// ---------------------------------------------------------------------------
// File loader — reads and validates the hooks portion of settings.json
// ---------------------------------------------------------------------------

function loadHooksFromFile(
  filePath: string,
): Record<string, HookMatcher[]> | undefined {
  // Fast path: check mtime to avoid re-reading unchanged files.
  const stat = statSync(filePath, { throwIfNoEntry: false })
  if (!stat) return undefined

  const cached = fileCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, data: undefined })
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn(`[hooks] Invalid JSON in ${filePath}`)
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, data: undefined })
    return undefined
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, data: undefined })
    return undefined
  }

  const settings = parsed as Record<string, unknown>
  if (!settings['hooks']) {
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, data: undefined })
    return undefined
  }

  const result = HooksSettingsSchema.safeParse(settings['hooks'])
  if (!result.success) {
    console.warn(`[hooks] Invalid hooks config in ${filePath}: ${result.error.message}`)
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, data: undefined })
    return undefined
  }

  const data = result.data as Record<string, HookMatcher[]> | undefined
  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, data })
  return data
}
