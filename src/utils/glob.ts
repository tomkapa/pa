import { isAbsolute, resolve, relative } from 'node:path'
import { ripGrep } from './ripgrep.js'
import { VCS_DIRS } from './vcs.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlobOptions {
  limit: number
  offset: number
}

export interface GlobResult {
  files: string[]
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 100
const DEFAULT_OFFSET = 0

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Handle absolute glob patterns by extracting the static base directory.
 * ripgrep's --glob only works with relative patterns.
 *
 * Example: `/src/components/**\/*.tsx` → { baseDir: '/src/components', pattern: '**\/*.tsx' }
 */
function splitAbsolutePattern(pattern: string): { baseDir: string; pattern: string } {
  if (!isAbsolute(pattern)) {
    return { baseDir: '', pattern }
  }

  // Find the first glob character (*, ?, [, {)
  const globChars = /[*?[{]/
  const match = globChars.exec(pattern)

  if (!match) {
    // No glob chars — treat the whole thing as a literal path
    return { baseDir: pattern, pattern: '**' }
  }

  // Split at the last path separator before the first glob char
  const beforeGlob = pattern.slice(0, match.index)
  const lastSep = beforeGlob.lastIndexOf('/')
  if (lastSep <= 0) {
    return { baseDir: '/', pattern: pattern.slice(1) }
  }

  return {
    baseDir: pattern.slice(0, lastSep),
    pattern: pattern.slice(lastSep + 1),
  }
}

// ---------------------------------------------------------------------------
// Glob function
// ---------------------------------------------------------------------------

/**
 * Find files matching a glob pattern using ripgrep's file-listing mode.
 *
 * - Sorts results by modification time (most recent first).
 * - Applies pagination via limit/offset.
 * - Returns absolute paths.
 */
export async function glob(
  pattern: string,
  cwd: string,
  options: Partial<GlobOptions> = {},
  abortSignal: AbortSignal,
): Promise<GlobResult> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const offset = options.offset ?? DEFAULT_OFFSET

  // Handle absolute patterns
  const { baseDir, pattern: relPattern } = splitAbsolutePattern(pattern)
  const searchDir = baseDir || cwd

  // Build ripgrep args for file listing
  const args: string[] = [
    '--files',
    '--glob', relPattern,
    '--sort=modified',
    '--hidden',
  ]

  // Exclude VCS directories
  for (const dir of VCS_DIRS) {
    args.push('--glob', `!${dir}`)
  }

  // Respect .gitignore by default, unless overridden
  if (process.env.PA_GLOB_NO_IGNORE === '1') {
    args.push('--no-ignore')
  }

  const rawPaths = await ripGrep(args, searchDir, abortSignal)

  // Paginate first, then resolve — avoids resolving paths we'll discard
  const slicedRaw = rawPaths.slice(offset, offset + limit)
  const truncated = rawPaths.length > offset + limit
  const files = slicedRaw.map(p => isAbsolute(p) ? p : resolve(searchDir, p))

  return { files, truncated }
}

/**
 * Convert absolute paths to relative paths from cwd for display.
 */
export function relativizePaths(paths: string[], cwd: string): string[] {
  return paths.map(p => relative(cwd, p))
}
