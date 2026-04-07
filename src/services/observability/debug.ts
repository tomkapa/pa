import { appendFileSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { envFlag, getObservabilityHome, getSessionId } from './state.js'

export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

interface DebugLoggerState {
  enabled: boolean
  initialized: boolean
  filePath: string
  buffer: string[]
  bufferBytes: number
  flushTimer: NodeJS.Timeout | null
}

/** Flush every second; small enough to feel live, large enough to coalesce bursts. */
const FLUSH_INTERVAL_MS = 1_000

/** Cap the in-memory buffer to keep memory bounded under runaway logging. */
const MAX_BUFFERED_BYTES = 256 * 1024

const state: DebugLoggerState = {
  enabled: false,
  initialized: false,
  filePath: '',
  buffer: [],
  bufferBytes: 0,
  flushTimer: null,
}

/**
 * Always-on in dev, opt-in (`PA_DEBUG=1`) in production and test, so test runs
 * don't litter the home directory.
 */
function shouldEnableDebug(): boolean {
  const explicit = envFlag('PA_DEBUG')
  if (explicit !== undefined) return explicit
  const nodeEnv = process.env['NODE_ENV']
  return nodeEnv !== 'production' && nodeEnv !== 'test'
}

function ensureInitialized(): void {
  if (state.initialized) return
  state.initialized = true
  state.enabled = shouldEnableDebug()
  if (!state.enabled) return

  const dir = join(getObservabilityHome(), 'debug')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // If the directory cannot be created, disable logging silently — debug
    // tooling must never crash the host process.
    state.enabled = false
    return
  }

  const sessionId = getSessionId()
  state.filePath = join(dir, `${sessionId}.txt`)

  // Touch the file so the symlink target exists.
  try {
    writeFileSync(state.filePath, '', { flag: 'a' })
  } catch {
    state.enabled = false
    return
  }

  // Refresh `latest` symlink. unlinkSync may fail if it doesn't exist; ignore.
  const latest = join(dir, 'latest')
  try {
    try {
      unlinkSync(latest)
    } catch {
      // ignore: missing or non-symlink leftover
    }
    symlinkSync(state.filePath, latest)
  } catch {
    // Symlinks may not be supported (e.g. some Windows configs). Not fatal.
  }

  state.flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS)
  state.flushTimer.unref()

  // Best-effort flush on exit + uncaught exceptions. Use synchronous writes
  // so the buffer reaches disk before the process tears down.
  process.on('exit', flushBufferSync)
  process.on('uncaughtException', flushBufferSync)
  process.on('SIGINT', flushBufferSync)
  process.on('SIGTERM', flushBufferSync)
}

function flushBuffer(): void {
  if (!state.enabled || state.buffer.length === 0) return
  const chunk = state.buffer.join('')
  state.buffer = []
  state.bufferBytes = 0
  // Fire-and-forget; swallow errors so logging cannot crash the app.
  import('node:fs/promises')
    .then(({ appendFile }) => appendFile(state.filePath, chunk))
    .catch(() => {})
}

function flushBufferSync(): void {
  if (!state.enabled || state.buffer.length === 0) return
  try {
    appendFileSync(state.filePath, state.buffer.join(''))
  } catch {
    // ignore
  }
  state.buffer = []
  state.bufferBytes = 0
}

/**
 * Append a debug line to the per-session log. Fire-and-forget: never throws,
 * never blocks the caller. Buffered in memory and flushed once per second.
 */
export function logForDebugging(message: string, opts?: { level?: LogLevel }): void {
  ensureInitialized()
  if (!state.enabled) return

  const level: LogLevel = opts?.level ?? 'debug'
  const line = `${new Date().toISOString()} [${level}] ${message}\n`

  state.buffer.push(line)
  state.bufferBytes += line.length
  // Force a flush early if the buffer is getting large.
  if (state.bufferBytes >= MAX_BUFFERED_BYTES) {
    flushBuffer()
  }
}

/**
 * Force the in-memory buffer to disk synchronously. Exposed for tests and
 * for shutdown paths that need a deterministic flush point.
 */
export function flushDebugLogSync(): void {
  flushBufferSync()
}

/**
 * Path of the active debug log for this session, or an empty string if the
 * logger is disabled. Useful for messages that point users at the file.
 */
export function getDebugLogPath(): string {
  ensureInitialized()
  return state.enabled ? state.filePath : ''
}

/**
 * Test-only reset hook. Clears in-memory state so subsequent calls re-init
 * against the current environment variables. Not exported from the module
 * barrel; tests import it directly.
 */
export function __resetDebugLoggerForTests(): void {
  if (state.flushTimer) {
    clearInterval(state.flushTimer)
  }
  state.enabled = false
  state.initialized = false
  state.filePath = ''
  state.buffer = []
  state.bufferBytes = 0
  state.flushTimer = null
}
