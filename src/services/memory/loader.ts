// ---------------------------------------------------------------------------
// Memory Loader (orchestrator)
//
// Walks the filesystem to load every CLAUDE.md, .claude/CLAUDE.md,
// .claude/rules/*.md, and CLAUDE.local.md the agent should know about,
// then returns them ordered from lowest to highest model attention.
//
// Order matters: files appear in the system prompt in the order returned
// here, and content placed later in the prompt typically gets more model
// attention. So Managed (lowest) → User → Project → Local (highest).
//
// Within Project/Local, we walk from the filesystem root *down* to CWD so
// that the most-specific (CWD-level) instructions appear last.
//
// Conditional rules (those with `paths:` frontmatter) are returned as a
// separate list — the caller decides when to inject them based on which
// files the agent is about to touch.
// ---------------------------------------------------------------------------

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { getManagedConfigRoot } from '../permissions/managed-settings.js'
import { processMemoryFile } from './file-reader.js'
import { processRulesDir, type RulesDirResult } from './rules-dir.js'
import type { MemoryFileInfo, MemoryType } from './types.js'

export interface LoadMemoryOptions {
  /** Working directory to walk up from. Defaults to `process.cwd()`. */
  cwd?: string
  /** Override the user home directory (used by tests). */
  home?: string
  /** Override the managed-config root (used by tests). */
  managedRoot?: string
}

export interface LoadedMemory {
  /** Files that should always be injected into the system prompt. */
  unconditional: MemoryFileInfo[]
  /**
   * Conditional rule files (with `paths:` frontmatter) that should only
   * be injected when the agent touches a matching file.
   */
  conditional: MemoryFileInfo[]
}

/**
 * Re-export the cross-platform managed-config root from
 * permissions/managed-settings.js, so callers of the memory module
 * don't need to reach into a sibling service.
 */
export { getManagedConfigRoot as getManagedRoot }

/**
 * Walk from `cwd` upward to the filesystem root, returning the directories
 * in **root-first order**. Used to ensure CWD-level files appear last in
 * the loaded list (highest model attention).
 *
 *   /a/b/c → ['/', '/a', '/a/b', '/a/b/c']
 */
export function walkUpFromCwd(cwd: string): string[] {
  const result: string[] = []
  let current = resolve(cwd)
  // Defensive cap to avoid infinite loops on broken filesystems.
  const maxIterations = 100
  for (let i = 0; i < maxIterations; i++) {
    result.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return result.reverse()
}

/**
 * Load every memory file the agent should be aware of.
 *
 * Order in the returned `unconditional` array (lowest priority first):
 *   1. Managed CLAUDE.md and managed rules
 *   2. User CLAUDE.md (~/.claude) and user rules
 *   3. For each ancestor directory of cwd (root → cwd):
 *        - <dir>/CLAUDE.md          (Project)
 *        - <dir>/.claude/CLAUDE.md  (Project)
 *        - <dir>/.claude/rules/*.md (Project, unconditional only)
 *        - <dir>/CLAUDE.local.md    (Local)
 *
 * Conditional rules (with `paths:` frontmatter) collected from any of the
 * `.claude/rules/` scans are returned in `conditional`.
 *
 * The cross-level walk is sequential because lower-priority levels claim
 * files in `processedPaths` that higher levels would otherwise duplicate.
 * Per-file work within a single rules directory still runs in parallel
 * (see `walkDir` in rules-dir.ts).
 */
export async function loadMemory(options: LoadMemoryOptions = {}): Promise<LoadedMemory> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const home = options.home ?? homedir()
  const managedRoot = options.managedRoot ?? getManagedConfigRoot()
  const homeClaudeDir = resolve(home, '.claude')

  const processedPaths = new Set<string>()
  const unconditional: MemoryFileInfo[] = []
  const conditional: MemoryFileInfo[] = []

  const pushRules = (rules: RulesDirResult): void => {
    unconditional.push(...rules.unconditional)
    conditional.push(...rules.conditional)
  }

  // 1. Managed (lowest priority).
  unconditional.push(
    ...(await processMemoryFile(join(managedRoot, 'CLAUDE.md'), 'Managed', processedPaths)),
  )
  pushRules(
    await processRulesDir(join(managedRoot, '.claude', 'rules'), 'Managed', processedPaths),
  )

  // 2. User (~/.claude).
  unconditional.push(
    ...(await processMemoryFile(join(home, '.claude', 'CLAUDE.md'), 'User', processedPaths)),
  )
  pushRules(
    await processRulesDir(join(home, '.claude', 'rules'), 'User', processedPaths),
  )

  // 3. Walk from filesystem root down to cwd. Each ancestor directory may
  // contribute Project (CLAUDE.md, .claude/CLAUDE.md, .claude/rules/) and
  // Local (CLAUDE.local.md) files.
  for (const dir of walkUpFromCwd(cwd)) {
    unconditional.push(
      ...(await processMemoryFile(join(dir, 'CLAUDE.md'), 'Project', processedPaths)),
    )
    // Don't double-load ~/.claude/CLAUDE.md as Project — that file is User.
    if (resolve(dir, '.claude') !== homeClaudeDir) {
      unconditional.push(
        ...(await processMemoryFile(
          join(dir, '.claude', 'CLAUDE.md'),
          'Project',
          processedPaths,
        )),
      )
      pushRules(
        await processRulesDir(join(dir, '.claude', 'rules'), 'Project', processedPaths),
      )
    }
    unconditional.push(
      ...(await processMemoryFile(join(dir, 'CLAUDE.local.md'), 'Local', processedPaths)),
    )
  }

  return { unconditional, conditional }
}

// ---------------------------------------------------------------------------
// Memoization
//
// `loadMemory` does a lot of filesystem I/O and the result is stable for
// the lifetime of a conversation (unless the user explicitly edits a
// CLAUDE.md file). We expose a memoized variant keyed on (cwd, home,
// managedRoot) — invalidate via `invalidateMemoryCache()`.
// ---------------------------------------------------------------------------

const memoryCache = new Map<string, Promise<LoadedMemory>>()

function cacheKey(opts: LoadMemoryOptions): string {
  return JSON.stringify({
    cwd: resolve(opts.cwd ?? process.cwd()),
    home: opts.home ?? homedir(),
    managedRoot: opts.managedRoot ?? getManagedConfigRoot(),
  })
}

/** Memoized form of {@link loadMemory}. */
export function getMemory(options: LoadMemoryOptions = {}): Promise<LoadedMemory> {
  const key = cacheKey(options)
  const existing = memoryCache.get(key)
  if (existing) return existing
  const fresh = loadMemory(options)
  memoryCache.set(key, fresh)
  // If the load fails, evict the rejected promise so a retry isn't poisoned.
  fresh.catch(() => memoryCache.delete(key))
  return fresh
}

/** Drop all memoized memory loads — call after editing a CLAUDE.md file. */
export function invalidateMemoryCache(): void {
  memoryCache.clear()
}
