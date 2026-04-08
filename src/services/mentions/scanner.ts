import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

// .gitignore support is intentionally deferred to a follow-up tech-debt task.
const SKIP_DIRS = new Set(['.git', 'node_modules'])

/** Bounded recursive walk of `root`, skipping `.git` and `node_modules`. */
export async function scanFiles(
  root: string,
  maxFiles: number,
): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [root]

  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()
    if (dir === undefined) break

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Permission errors, missing directories, symlink loops — a single
      // unreadable subtree should not blow up the whole scan.
      continue
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        out.push(relative(root, full))
        if (out.length >= maxFiles) break
      }
    }
  }

  return out
}
