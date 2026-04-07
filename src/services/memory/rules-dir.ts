// ---------------------------------------------------------------------------
// Rules Directory Processor
//
// Recursively reads `.md` files from a `.claude/rules/` directory and
// partitions them into unconditional rules and conditional rules
// (those with `paths:` frontmatter).
//
// Splitting them lets the system-prompt builder inject unconditional rules
// up front while deferring conditional rules until the agent actually
// touches a matching file.
//
// Symlink cycles are detected via realpath: every directory we've already
// entered is recorded so we don't spin forever on `loop -> ..`.
// ---------------------------------------------------------------------------

import { readdir, realpath, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { isExpectedFsError } from './fs-errors.js'
import { isNodeError } from '../../utils/error.js'
import { processMemoryFile } from './file-reader.js'
import type { MemoryFileInfo, MemoryType } from './types.js'

export interface RulesDirResult {
  unconditional: MemoryFileInfo[]
  conditional: MemoryFileInfo[]
}

/**
 * Walk a `.claude/rules/` directory tree and load every `.md` file inside,
 * partitioning the results by whether they have `paths:` frontmatter.
 */
export async function processRulesDir(
  rulesDir: string,
  type: MemoryType,
  processedPaths: Set<string>,
): Promise<RulesDirResult> {
  const visitedDirs = new Set<string>()
  const result: RulesDirResult = { unconditional: [], conditional: [] }
  await walkDir(rulesDir, type, processedPaths, visitedDirs, result)
  return result
}

async function walkDir(
  dir: string,
  type: MemoryType,
  processedPaths: Set<string>,
  visitedDirs: Set<string>,
  result: RulesDirResult,
): Promise<void> {
  let realDir: string
  try {
    realDir = await realpath(dir)
  } catch (err) {
    if (isNodeError(err) && isExpectedFsError(err.code)) return
    throw err
  }
  if (visitedDirs.has(realDir)) return
  visitedDirs.add(realDir)

  let entries: string[]
  try {
    entries = await readdir(realDir, { withFileTypes: false })
  } catch (err) {
    if (isNodeError(err) && isExpectedFsError(err.code)) return
    throw err
  }

  // Sort for deterministic ordering — readdir order is filesystem-dependent
  // and we want stable system prompts across platforms.
  entries.sort()

  // Partition into subdirs and .md files in one pass so file processing
  // can run in parallel while subdir traversal stays sequential (so the
  // visited-dirs set is consistent).
  const mdFiles: string[] = []
  for (const entry of entries) {
    const fullPath = join(realDir, entry)

    let entryStat: Awaited<ReturnType<typeof stat>>
    try {
      entryStat = await stat(fullPath)
    } catch (err) {
      if (isNodeError(err) && isExpectedFsError(err.code)) continue
      throw err
    }

    if (entryStat.isDirectory()) {
      await walkDir(fullPath, type, processedPaths, visitedDirs, result)
      continue
    }

    if (entryStat.isFile() && extname(entry).toLowerCase() === '.md') {
      mdFiles.push(fullPath)
    }
  }

  // Files within a single directory are independent — load them in parallel.
  const loaded = await Promise.all(
    mdFiles.map(p => processMemoryFile(p, type, processedPaths)),
  )

  for (const files of loaded) {
    for (const file of files) {
      if (file.globs !== undefined) {
        result.conditional.push(file)
      } else {
        result.unconditional.push(file)
      }
    }
  }
}
