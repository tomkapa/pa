// ---------------------------------------------------------------------------
// Conditional Rule Matching
//
// Conditional rules (those with `paths:` frontmatter) are loaded once but
// only injected into the prompt when the agent touches a matching path.
// This module answers the question "does this file's globs match this
// target path?" using gitignore-style semantics.
//
// Patterns are interpreted relative to a base directory:
//   - Project rules: the directory that contains the `.claude/` folder.
//   - User / Managed rules: the current working directory.
// ---------------------------------------------------------------------------

import { isAbsolute } from 'node:path'
import { matchFilePatterns } from '../permissions/file-pattern-matching.js'
import type { MemoryFileInfo } from './types.js'

/**
 * Check whether a target file path matches a conditional rule file.
 *
 * - Returns `false` if the file is not conditional (no `paths:` frontmatter).
 * - Returns `false` if either path is not absolute (we need an absolute
 *   anchor to compute the base-relative path the pattern is matched against).
 */
export function matchesConditionalRule(
  file: MemoryFileInfo,
  targetPath: string,
  baseDir: string,
): boolean {
  if (!file.globs || file.globs.length === 0) return false
  if (!isAbsolute(targetPath) || !isAbsolute(baseDir)) return false
  return matchFilePatterns(targetPath, file.globs, baseDir)
}

/**
 * Filter a list of memory files down to those whose conditional rules
 * match `targetPath`. Unconditional files are dropped — use this only
 * when answering "what extra context applies to this specific path?".
 */
export function filterConditionalMatches(
  files: MemoryFileInfo[],
  targetPath: string,
  baseDir: string,
): MemoryFileInfo[] {
  return files.filter(f => matchesConditionalRule(f, targetPath, baseDir))
}
