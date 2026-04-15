import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export interface DiscoveredCommand {
  name: string
  filePath: string
  source: 'user' | 'project'
}

export const SKILL_FILE = 'SKILL.md'

/**
 * Derive a command name from a file path relative to its commands directory.
 *
 * - Removes the `.md` extension
 * - Replaces path separators with colons
 * - Lowercases the result
 * - Handles SKILL.md directory-based pattern: `command-name/SKILL.md` → `command-name`
 */
export function deriveCommandName(relativePath: string, sep: string): string {
  // Normalize backslashes to forward slashes (no-op on POSIX)
  const normalized = relativePath.replaceAll('\\', '/')

  // Handle SKILL.md directory-based pattern
  if (normalized.endsWith(`/${SKILL_FILE}`)) {
    const dirPart = normalized.slice(0, -(SKILL_FILE.length + 1))
    return dirPart.replaceAll('/', ':').toLowerCase()
  }

  // Standard pattern: remove .md extension, replace separators with colons
  const withoutExt = normalized.replace(/\.md$/i, '')
  return withoutExt.replaceAll('/', ':').toLowerCase()
}

/**
 * Recursively walk a directory and collect all `.md` files, returning their
 * paths relative to the root directory.
 */
async function walkMdFiles(dir: string, rootDir: string): Promise<string[]> {
  const results: string[] = []

  let entries: import('node:fs').Dirent[]
  try {
    const raw = await readdir(dir, { withFileTypes: true })
    entries = raw as unknown as import('node:fs').Dirent[]
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, String(entry.name))
    if (entry.isDirectory()) {
      // Check for SKILL.md inside the directory
      const skillPath = path.join(fullPath, SKILL_FILE)
      try {
        const s = await stat(skillPath)
        if (s.isFile()) {
          results.push(path.relative(rootDir, skillPath))
          // Don't recurse further into SKILL.md directories
          continue
        }
      } catch {
        // No SKILL.md, recurse normally
      }
      const nested = await walkMdFiles(fullPath, rootDir)
      results.push(...nested)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(path.relative(rootDir, fullPath))
    }
  }

  return results
}

/**
 * Scan one or more command directories and discover all `.md` command files.
 *
 * Deduplicates by `realpath()` to handle symlinks pointing to the same file.
 * Non-existent directories are silently skipped (walkMdFiles handles the error).
 */
export async function scanCommandDirectories(
  dirs: string[],
  source: 'user' | 'project',
): Promise<DiscoveredCommand[]> {
  const commands: DiscoveredCommand[] = []
  const seenRealPaths = new Set<string>()

  for (const dir of dirs) {
    // walkMdFiles already handles non-existent dirs via its readdir try/catch
    const relativePaths = await walkMdFiles(dir, dir)

    for (const relPath of relativePaths) {
      const fullPath = path.join(dir, relPath)
      let resolvedPath: string
      try {
        resolvedPath = await realpath(fullPath)
      } catch {
        resolvedPath = fullPath
      }

      if (seenRealPaths.has(resolvedPath)) continue
      seenRealPaths.add(resolvedPath)

      commands.push({
        name: deriveCommandName(relPath, path.sep),
        filePath: fullPath,
        source,
      })
    }
  }

  return commands
}
