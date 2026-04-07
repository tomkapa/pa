import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Per-process session identifier. Treat as immutable for the process lifetime.
 * Used to correlate debug logs, prompt dumps, and traces.
 */
const SESSION_ID = randomUUID()

export function getSessionId(): string {
  return SESSION_ID
}

/**
 * Root directory for local-only observability artifacts. Defaults to `~/.pa`;
 * `PA_HOME` lets tests redirect writes to a scratch directory.
 */
export function getObservabilityHome(): string {
  const override = process.env['PA_HOME']
  if (override && override.length > 0) return override
  return join(homedir(), '.pa')
}

/**
 * Three-state env-var flag parser. `'1'`/`'true'` → true, `'0'`/`'false'` →
 * false, anything else → undefined. Lets callers distinguish "explicitly off"
 * from "unset" without re-implementing the parsing dance.
 */
export function envFlag(name: string): boolean | undefined {
  const v = process.env[name]
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return undefined
}
