// ---------------------------------------------------------------------------
// User and System Context Loaders
//
// Two context bundles travel ALONGSIDE the system prompt but are not part
// of it:
//
//   - userContext   — CLAUDE.md content + the current date
//   - systemContext — git status snapshot
//
// We keep them separate from the static prompt because they would
// otherwise bust the global static-prompt cache (CLAUDE.md is per-project,
// git status is per-checkout). The API layer attaches them as additional
// cached blocks behind the dynamic boundary.
//
// Both context bundles are memoized for the lifetime of a session — git
// status in particular is a snapshot taken when the conversation started
// and intentionally does NOT update if the user runs commands during the
// conversation. The user-visible string says so explicitly so the model
// doesn't get confused by stale data.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import {
  formatMemoryForPrompt,
  loadMemory,
  type LoadMemoryOptions,
} from '../memory/index.js'
import type { SystemContext, UserContext } from './types.js'

// ---------------------------------------------------------------------------
// Memoization
// ---------------------------------------------------------------------------

/**
 * Tiny single-key memoizer. We don't pull in lodash-es just for this — the
 * call sites all want "compute once per session, reset on /clear" and a
 * one-line wrapper is clearer than an external dependency.
 */
function memoizeAsync<T>(fn: () => Promise<T>): {
  get: () => Promise<T>
  reset: () => void
} {
  let cached: Promise<T> | undefined
  return {
    get: () => {
      if (cached === undefined) {
        cached = fn()
        // If the underlying call rejects, evict so a retry isn't poisoned.
        cached.catch(() => {
          cached = undefined
        })
      }
      return cached
    },
    reset: () => {
      cached = undefined
    },
  }
}

// ---------------------------------------------------------------------------
// Subprocess helper — used for git CLI calls
// ---------------------------------------------------------------------------

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

/**
 * Run a command and capture stdout/stderr. Used for the small number of
 * `git` invocations needed to build the status snapshot. We avoid pulling
 * in execa or similar because the surface area we need is tiny.
 */
function execCapture(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<ExecResult> {
  return new Promise((resolveExec, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on('data', chunk => stdoutChunks.push(chunk as Buffer))
    child.stderr?.on('data', chunk => stderrChunks.push(chunk as Buffer))
    child.on('error', err => reject(err))
    child.on('close', code => {
      resolveExec({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

const STATUS_TRUNCATE_BYTES = 2000
const RECENT_COMMITS_COUNT = 5

async function gitText(args: string[], cwd: string): Promise<string> {
  try {
    const result = await execCapture('git', args, cwd)
    if (result.exitCode !== 0) return ''
    return result.stdout.trim()
  } catch {
    // git binary not on PATH or other spawn failure — treat as no output.
    return ''
  }
}

async function getDefaultBranch(cwd: string): Promise<string> {
  // Try the symbolic-ref form first (works when origin/HEAD is set), then
  // fall back to the configured init.defaultBranch, then guess.
  const symbolic = await gitText(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd)
  if (symbolic) return symbolic.replace(/^origin\//, '')
  const initDefault = await gitText(['config', '--get', 'init.defaultBranch'], cwd)
  if (initDefault) return initDefault
  return 'main'
}

/**
 * Build the git-status snapshot. Returns `undefined` outside a repo so
 * callers can `.filter()` it out cleanly.
 *
 * The text format and ordering match what the user-visible system prompt
 * already prints elsewhere in the codebase, so the model sees a
 * consistent shape regardless of which entry point produced the snapshot.
 *
 * Detection of "is this a repo" is folded into the same parallel batch
 * as the data fetches: an empty branch means we're not inside a work
 * tree (or git is missing), and we bail without emitting a snapshot.
 */
export async function buildGitStatus(cwd: string): Promise<string | undefined> {
  const [branch, defaultBranch, statusRaw, log, userName] = await Promise.all([
    gitText(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    getDefaultBranch(cwd),
    gitText(['status', '--short'], cwd),
    gitText(['log', '--oneline', '-n', String(RECENT_COMMITS_COUNT)], cwd),
    gitText(['config', 'user.name'], cwd),
  ])

  if (!branch) return undefined

  const truncatedStatus =
    statusRaw.length > STATUS_TRUNCATE_BYTES
      ? `${statusRaw.slice(0, STATUS_TRUNCATE_BYTES)}\n... (truncated)`
      : statusRaw

  const parts: string[] = []
  parts.push(
    'This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.',
  )
  parts.push(`Current branch: ${branch}`)
  parts.push(`Main branch (you will usually use this for PRs): ${defaultBranch}`)
  if (userName) parts.push(`Git user: ${userName}`)
  parts.push(`Status:\n${truncatedStatus || '(clean)'}`)
  if (log) parts.push(`Recent commits:\n${log}`)
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// User / System context loaders
// ---------------------------------------------------------------------------

export interface ContextOptions {
  cwd?: string
  /** Override "today" — used by tests so the snapshot is deterministic. */
  now?: Date
  /** Forwarded to `loadMemory` — lets tests point at fixture directories. */
  memoryOptions?: LoadMemoryOptions
}

function isoDate(date: Date): string {
  // YYYY-MM-DD in the local timezone — matches the format already used
  // elsewhere in the codebase for "today's date" prompt fragments.
  const yyyy = date.getFullYear().toString().padStart(4, '0')
  const mm = (date.getMonth() + 1).toString().padStart(2, '0')
  const dd = date.getDate().toString().padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

async function loadUserContext(options: ContextOptions): Promise<UserContext> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const memory = await loadMemory({ cwd, ...options.memoryOptions })
  const claudeMd = formatMemoryForPrompt(memory.unconditional)
  return {
    claudeMd: claudeMd.length > 0 ? claudeMd : undefined,
    currentDate: isoDate(options.now ?? new Date()),
  }
}

/**
 * Load the user context bundle: CLAUDE.md hierarchy + current date.
 * Memoized per process — call `resetUserContextCache()` after `/clear` or
 * `/compact`. Tests that pass any option bypass the memoizer so each
 * fixture stays isolated.
 */
const userContextCache = memoizeAsync<UserContext>(() => loadUserContext({}))

export function getUserContext(options: ContextOptions = {}): Promise<UserContext> {
  if (options.cwd !== undefined || options.now !== undefined || options.memoryOptions) {
    return loadUserContext(options)
  }
  return userContextCache.get()
}

export function resetUserContextCache(): void {
  userContextCache.reset()
}

async function loadSystemContext(options: ContextOptions): Promise<SystemContext> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const gitStatus = await buildGitStatus(cwd)
  return { gitStatus }
}

/**
 * Load the system context bundle: git status snapshot. Memoized per
 * process — `resetSystemContextCache()` after `/clear` or `/compact`.
 */
const systemContextCache = memoizeAsync<SystemContext>(() => loadSystemContext({}))

export function getSystemContext(options: ContextOptions = {}): Promise<SystemContext> {
  if (options.cwd !== undefined) {
    return loadSystemContext(options)
  }
  return systemContextCache.get()
}

export function resetSystemContextCache(): void {
  systemContextCache.reset()
}
