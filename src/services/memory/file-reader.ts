// ---------------------------------------------------------------------------
// Memory File Reader
//
// Reads a single file from disk, parses its frontmatter, and recursively
// follows @include directives. Cycle detection (via processedPaths) and a
// hard depth cap (5) prevent runaway loads from malicious or buggy includes.
// ---------------------------------------------------------------------------

import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { isNodeError } from '../../utils/error.js'
import { expandPath } from '../../utils/expandPath.js'
import { extractGlobs, parseFrontmatter } from './frontmatter.js'
import { isExpectedFsError } from './fs-errors.js'
import { extractIncludes } from './include-extractor.js'
import type { MemoryFileInfo, MemoryType } from './types.js'

/** Maximum depth of @include recursion before we stop following references. */
export const MAX_INCLUDE_DEPTH = 5

/**
 * File extensions we are willing to read into the system prompt.
 *
 * The list is intentionally narrow: anything not in here is treated as a
 * binary file and skipped. This protects us from accidentally including
 * `@./image.png` or other large opaque blobs into the model context.
 */
const ALLOWED_EXTENSIONS = new Set<string>([
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.sh',
  '.py',
  '.rs',
  '.go',
  '.rb',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.csv',
])

/**
 * Read a single file from disk and produce a `MemoryFileInfo`.
 *
 * Returns `null` for any "expected miss" — file not found, permission
 * denied, or unsupported extension. Truly unexpected errors are rethrown.
 *
 * IMPORTANT: this does NOT follow @include directives. Use
 * {@link processMemoryFile} for the recursive variant.
 */
export async function readMemoryFile(
  filePath: string,
  type: MemoryType,
  parent?: string,
): Promise<MemoryFileInfo | null> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '' || !ALLOWED_EXTENSIONS.has(ext)) {
    return null
  }

  let content: string
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return null
    content = await readFile(filePath, 'utf-8')
  } catch (err) {
    if (isNodeError(err) && isExpectedFsError(err.code)) {
      return null
    }
    throw err
  }

  const { frontmatter, content: stripped } = parseFrontmatter(content)
  const globs = extractGlobs(frontmatter)

  return {
    path: filePath,
    type,
    content: stripped,
    parent,
    globs,
  }
}

/**
 * Read a memory file and recursively follow its @include directives.
 *
 * `processedPaths` is a shared set across the whole load — once a file has
 * been visited (by absolute path), it will not be visited again. This both
 * deduplicates entries and prevents infinite recursion via cycles
 * (A includes B includes A).
 *
 * Returns the file plus all transitively-included files in
 * **breadth-first order**: parent first, then its direct includes, then
 * their includes, etc. The order matters for the system prompt — children
 * appear after their parent so the labels read top-down.
 */
export async function processMemoryFile(
  filePath: string,
  type: MemoryType,
  processedPaths: Set<string>,
  depth: number = 0,
  parent?: string,
): Promise<MemoryFileInfo[]> {
  const absolute = resolve(filePath)
  if (processedPaths.has(absolute)) return []
  if (depth > MAX_INCLUDE_DEPTH) return []
  processedPaths.add(absolute)

  const file = await readMemoryFile(absolute, type, parent)
  if (!file) return []

  const result: MemoryFileInfo[] = [file]

  const includes = extractIncludes(file.content)
  const baseDir = dirname(absolute)
  for (const includePath of includes) {
    // expandPath handles `~/`, absolute, and base-relative paths in one shot
    // and rejects null-byte injection.
    const resolved = expandPath(includePath, baseDir)
    // Inherit type from the parent so an include from a Project file is
    // labeled Project, not Local.
    const children = await processMemoryFile(
      resolved,
      type,
      processedPaths,
      depth + 1,
      absolute,
    )
    result.push(...children)
  }

  return result
}
