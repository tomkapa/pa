// ---------------------------------------------------------------------------
// File Path Pattern Matching for File Tool Permission Rules
//
// Uses gitignore-style patterns via the `ignore` npm package.
// File paths have directory semantics (recursive `**`, path separators)
// that shell commands don't — this is a completely separate matching
// system from wildcard-matching.ts.
//
// Patterns are relative to a root directory. Paths are normalized to
// POSIX format before matching.
// ---------------------------------------------------------------------------

import ignore, { type Ignore } from 'ignore'
import path from 'node:path'

// Cache compiled ignore instances — patterns are stable after rule loading
const ignoreCache = new Map<string, Ignore>()

function getIgnoreInstance(pattern: string): Ignore {
  let ig = ignoreCache.get(pattern)
  if (!ig) {
    ig = ignore().add(pattern)
    ignoreCache.set(pattern, ig)
  }
  return ig
}

/**
 * Check if a file path matches a gitignore-style pattern.
 *
 * @param filePath - The absolute or relative file path to test
 * @param pattern - A gitignore-style pattern (e.g., `src/**\/*.ts`, `*.secret`)
 * @param rootDir - The root directory for relative pattern resolution
 * @returns true if the file path matches the pattern
 */
export function matchFilePattern(
  filePath: string,
  pattern: string,
  rootDir: string,
): boolean {
  const normalizedPath = toRelativePosix(filePath, rootDir)
  if (normalizedPath === undefined) return false

  return getIgnoreInstance(pattern).ignores(normalizedPath)
}

/**
 * Check if a file path matches any of the given patterns.
 *
 * @param filePath - The absolute or relative file path to test
 * @param patterns - Array of gitignore-style patterns
 * @param rootDir - The root directory for relative pattern resolution
 * @returns true if the file path matches any pattern
 */
export function matchFilePatterns(
  filePath: string,
  patterns: string[],
  rootDir: string,
): boolean {
  if (patterns.length === 0) return false

  const normalizedPath = toRelativePosix(filePath, rootDir)
  if (normalizedPath === undefined) return false

  const ig = ignore().add(patterns)
  return ig.ignores(normalizedPath)
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function toRelativePosix(filePath: string, rootDir: string): string | undefined {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(rootDir, filePath)

  const relative = path.relative(rootDir, absolutePath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined
  }

  return relative.split(path.sep).join('/')
}
