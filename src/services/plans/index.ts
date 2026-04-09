// ---------------------------------------------------------------------------
// Plans Module — per-session plan file management
//
// Each session gets a unique human-readable slug (e.g. "brave-tiger") that
// maps to a Markdown file on disk. The plan file is the shared medium
// between the model (which writes it via Write/Edit tools) and the
// ExitPlanMode tool (which reads it to echo back on approval).
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { getConfigHomeDir } from '../session/paths.js'
import { getSessionId } from '../observability/state.js'
import { isNodeError } from '../../utils/error.js'

// ---------------------------------------------------------------------------
// Word lists for slug generation
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  'bold', 'brave', 'bright', 'calm', 'clear', 'cool', 'crisp', 'deft',
  'fair', 'fast', 'firm', 'glad', 'keen', 'kind', 'lean', 'neat',
  'pale', 'pure', 'quick', 'rare', 'safe', 'sharp', 'slim', 'soft',
  'sure', 'swift', 'tidy', 'warm', 'wise', 'vivid',
] as const

const ANIMALS = [
  'bear', 'crane', 'crow', 'deer', 'dove', 'eagle', 'elk', 'falcon',
  'finch', 'fox', 'hawk', 'heron', 'lark', 'lynx', 'otter', 'owl',
  'puma', 'raven', 'robin', 'seal', 'snake', 'stork', 'swan', 'tiger',
  'trout', 'viper', 'whale', 'wolf', 'wren', 'zebra',
] as const

// ---------------------------------------------------------------------------
// Per-session slug cache
// ---------------------------------------------------------------------------

const slugCache = new Map<string, string>()
let plansDirCreated = false

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getPlansDirectory(): string {
  const dir = join(getConfigHomeDir(), 'plans')
  if (!plansDirCreated) {
    mkdirSync(dir, { recursive: true })
    plansDirCreated = true
  }
  return dir
}

export function getPlanSlug(sessionId: string): string {
  const cached = slugCache.get(sessionId)
  if (cached) return cached

  const plansDir = getPlansDirectory()
  for (let i = 0; i < 10; i++) {
    const slug = `${pickRandom(ADJECTIVES)}-${pickRandom(ANIMALS)}`
    if (!existsSync(join(plansDir, `${slug}.md`))) {
      slugCache.set(sessionId, slug)
      return slug
    }
  }

  // Fallback: guarantee uniqueness by appending a sessionId fragment
  const fallback = `${pickRandom(ADJECTIVES)}-${pickRandom(ANIMALS)}-${sessionId.slice(0, 6)}`
  slugCache.set(sessionId, fallback)
  return fallback
}

export function getPlanFilePath(sessionId: string): string {
  return join(getPlansDirectory(), `${getPlanSlug(sessionId)}.md`)
}

export function getPlan(sessionId: string): string | null {
  try {
    return readFileSync(getPlanFilePath(sessionId), 'utf-8')
  } catch (e: unknown) {
    if (isNodeError(e) && e.code === 'ENOENT') return null
    throw e
  }
}

export function clearPlanSlug(sessionId: string): void {
  slugCache.delete(sessionId)
}

/**
 * Strict check: returns true ONLY if `absolutePath` is exactly the
 * current session's plan file. Not a prefix check — prevents the model
 * from writing arbitrary files in the plans directory.
 */
export function isSessionPlanFile(absolutePath: string): boolean {
  const expected = getPlanFilePath(getSessionId())
  return normalize(absolutePath) === normalize(expected)
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Test-only: clear caches so tests don't leak state. */
export function __clearSlugCacheForTests(): void {
  slugCache.clear()
  plansDirCreated = false
}
