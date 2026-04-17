import { promises as fs } from 'node:fs'
import path from 'node:path'
import lockfile from 'proper-lockfile'
import { isNodeError } from '../../utils/error.js'

// `proper-lockfile` requires the target to exist. The first acquisition per
// path creates the file; subsequent ones skip the mkdir/open dance — this
// matters because the inbox poller hits every 1s per agent.
const LOCK_OPTIONS = {
  stale: 10_000,
  retries: {
    retries: 10,
    minTimeout: 50,
    maxTimeout: 500,
    factor: 1.5,
    randomize: true,
  },
} as const

const ensuredPaths = new Set<string>()

async function ensureFile(filePath: string): Promise<void> {
  if (ensuredPaths.has(filePath)) return
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    const fh = await fs.open(filePath, 'a')
    await fh.close()
    ensuredPaths.add(filePath)
  } catch {
    // Leave un-cached; the next lock attempt will surface the real error.
  }
}

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  await ensureFile(filePath)
  const release = await lockfile.lock(filePath, LOCK_OPTIONS)
  try {
    return await fn()
  } finally {
    try {
      await release()
    } catch {
      // Unlock can fail if the file was removed mid-op (team deletion); the
      // stale-timeout recovers any orphaned lock.
    }
  }
}

/** Read a JSON file, returning `fallback` when missing, empty, or malformed. */
export async function readJsonOrFallback<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  try {
    const data = await fs.readFile(filePath, 'utf8')
    if (data.trim().length === 0) return fallback
    return JSON.parse(data) as T
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return fallback
    return fallback
  }
}

/** Read a JSON file, returning `null` on ENOENT and rethrowing other errors. */
export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const data = await fs.readFile(filePath, 'utf8')
    if (data.trim().length === 0) return null
    return JSON.parse(data) as T
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}
