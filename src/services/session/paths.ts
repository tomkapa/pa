import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'

// Session files live at: <configHome>/projects/<sanitized-cwd>/<sessionId>.jsonl
// `configHome` is overridable via $PA_CONFIG_DIR for test isolation.

/** Stays under Windows MAX_PATH and ecryptfs name limits; anything longer is
 *  truncated and hash-suffixed. */
const MAX_SANITIZED_NAME_LENGTH = 120

export function getConfigHomeDir(): string {
  const override = process.env.PA_CONFIG_DIR
  if (override && override.length > 0) return override
  return path.join(homedir(), '.pa')
}

export function getProjectsDir(): string {
  return path.join(getConfigHomeDir(), 'projects')
}

/**
 * Pure mapping from cwd to a safe directory name. Long paths are truncated
 * and hash-suffixed so distinct long paths never collide after truncation.
 */
export function sanitizePath(cwd: string): string {
  const normalized = path.resolve(cwd)
  const raw = normalized
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  const base = raw.length === 0 ? 'root' : raw
  if (base.length <= MAX_SANITIZED_NAME_LENGTH) return base

  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8)
  const budget = MAX_SANITIZED_NAME_LENGTH - hash.length - 1
  return `${base.slice(0, budget)}-${hash}`
}

export function getProjectDir(cwd: string): string {
  return path.join(getProjectsDir(), sanitizePath(cwd))
}

export function getSessionFilePath(cwd: string, sessionId: string): string {
  return path.join(getProjectDir(cwd), `${sessionId}.jsonl`)
}
