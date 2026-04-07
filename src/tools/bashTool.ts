import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { z, type ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam, ToolUseContext, PermissionResult } from '../services/tools/types.js'
import { semanticNumber } from '../utils/schema.js'
import { checkProtectedPath } from '../services/permissions/safety.js'
import {
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseProgressMessage,
  isResultTruncated,
  getActivityDescription,
} from './bashToolUI.js'

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface BashToolInput {
  command: string
  timeout?: number
  description?: string
}

export interface BashToolOutput {
  stdout: string
  stderr: string
  exitCode: number
  interrupted: boolean
}

/**
 * Progress payload streamed while a Bash command runs.
 *
 * Carries the latest accumulated stdout/stderr buffers (not deltas) so the
 * renderer can show the most recent output without having to stitch deltas
 * together. `elapsedMs` lets the renderer surface a running clock when output
 * is sparse.
 */
export interface BashProgress {
  stdout: string
  stderr: string
  elapsedMs: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
// Minimum gap between chunk-driven progress emits — keeps the REPL re-render
// rate ≤ ~10 Hz on chatty commands while still feeling live.
const PROGRESS_MIN_INTERVAL_MS = 100

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SHELL_PATH = process.env.SHELL || '/bin/bash'

const CHILD_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_EDITOR: 'true',
  PA_AGENT: '1',
}

function makeCwdTempPath(): string {
  return join(tmpdir(), `pa-cwd-${randomUUID()}`)
}

function wrapCommand(userCommand: string, cwdFile: string): string {
  // >| forces overwrite even with noclobber set
  return `eval ${shellQuote(userCommand)} && pwd -P >| ${shellQuote(cwdFile)}`
}

function shellQuote(s: string): string {
  return "$'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

function truncatePreview(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s
}

/**
 * Kill an entire process tree by sending SIGKILL to the process group.
 * Works because we spawn with `detached: true`, making the child the
 * leader of a new process group (PGID === PID). Negative PID targets
 * the whole group in a single syscall — no need to walk /proc or parse ps.
 */
function killProcessTree(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Process group may have already exited; try the single process
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone
    }
  }
}

// ---------------------------------------------------------------------------
// CWD state — module-level so it persists across calls within the same session
// ---------------------------------------------------------------------------

let currentCwd: string = process.cwd()

export function getCwd(): string {
  return currentCwd
}

export function setCwd(newCwd: string): void {
  currentCwd = newCwd
}

export function resetCwd(): void {
  currentCwd = process.cwd()
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

function executeCommand(
  command: string,
  timeoutMs: number,
  abortSignal: AbortSignal,
  onProgress?: (progress: BashProgress) => void,
): Promise<BashToolOutput> {
  return new Promise<BashToolOutput>((resolve) => {
    const cwdFile = makeCwdTempPath()
    const wrappedCommand = wrapCommand(command, cwdFile)

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let interrupted = false
    let resolved = false
    const startedAt = Date.now()

    // Wait for exit + both stream ends before resolving (exit fires before pipes drain)
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null
    let stdoutEnded = false
    let stderrEnded = false

    // Coalesce progress emits to avoid two pathological cases:
    //   (a) silent long commands rebuilding the (unchanged) buffer every
    //       heartbeat tick — short-circuit when bytes & elapsed-second are
    //       both unchanged;
    //   (b) chatty commands emitting on every chunk — throttle to PROGRESS_
    //       MIN_INTERVAL_MS so we never re-render the REPL more than ~10×/sec.
    let stdoutBytes = 0
    let stderrBytes = 0
    let lastEmittedStdoutBytes = -1
    let lastEmittedStderrBytes = -1
    let lastEmittedSecond = -1
    let lastEmittedAt = 0

    const emitProgress = onProgress
      ? () => {
          const now = Date.now()
          const currentSecond = Math.floor((now - startedAt) / 1000)
          const bytesUnchanged =
            stdoutBytes === lastEmittedStdoutBytes &&
            stderrBytes === lastEmittedStderrBytes
          if (bytesUnchanged) {
            // Heartbeat tick with no new bytes — only emit when the elapsed
            // clock would actually advance.
            if (currentSecond === lastEmittedSecond) return
          } else {
            // Chunk arrived — throttle to keep re-render rate sane on chatty
            // commands like `npm install`.
            if (now - lastEmittedAt < PROGRESS_MIN_INTERVAL_MS) return
          }
          lastEmittedStdoutBytes = stdoutBytes
          lastEmittedStderrBytes = stderrBytes
          lastEmittedSecond = currentSecond
          lastEmittedAt = now
          onProgress({
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            elapsedMs: now - startedAt,
          })
        }
      : null

    // Heartbeat: ensure long-running commands surface elapsed time even when
    // they produce no output. Cleared on resolve so we never leak timers.
    const heartbeat = emitProgress
      ? setInterval(emitProgress, 1_000)
      : null

    const child: ChildProcess = spawn(SHELL_PATH, ['-c', wrappedCommand], {
      cwd: getCwd(),
      env: CHILD_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    })

    child.stdin?.end()

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
      stdoutBytes += chunk.length
      emitProgress?.()
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
      stderrBytes += chunk.length
      emitProgress?.()
    })

    function tryResolve() {
      if (resolved || !exitInfo || !stdoutEnded || !stderrEnded) return
      resolved = true

      clearTimeout(timer)
      if (heartbeat) clearInterval(heartbeat)
      abortSignal.removeEventListener('abort', onAbort)

      const { code, signal } = exitInfo

      // Read cwd synchronously to stay in the same microtask
      try {
        const newCwd = readFileSync(cwdFile, 'utf8').trim()
        if (newCwd && newCwd !== getCwd()) {
          setCwd(newCwd)
        }
      } catch {
        // Command may have failed before pwd ran — cwd unchanged
      }
      try {
        unlinkSync(cwdFile)
      } catch {
        // File may not exist
      }

      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? (signal ? 137 : 1),
        interrupted,
      })
    }

    child.stdout?.on('end', () => {
      stdoutEnded = true
      tryResolve()
    })

    child.stderr?.on('end', () => {
      stderrEnded = true
      tryResolve()
    })

    const timer = setTimeout(() => {
      interrupted = true
      if (child.pid != null) {
        killProcessTree(child.pid)
      }
    }, timeoutMs)

    const onAbort = () => {
      interrupted = true
      if (child.pid != null) {
        killProcessTree(child.pid)
      }
    }
    abortSignal.addEventListener('abort', onAbort, { once: true })

    child.on('exit', (code, signal) => {
      exitInfo = { code, signal }
      tryResolve()
    })

    // Handle spawn errors (e.g., shell binary not found)
    child.on('error', (err) => {
      if (resolved) return
      resolved = true

      clearTimeout(timer)
      if (heartbeat) clearInterval(heartbeat)
      abortSignal.removeEventListener('abort', onAbort)
      child.stdout?.destroy()
      child.stderr?.destroy()

      const collectedStderr = Buffer.concat(stderrChunks).toString('utf8')
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: collectedStderr + (collectedStderr ? '\n' : '') + err.message,
        exitCode: 1,
        interrupted: false,
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

function formatResult(output: BashToolOutput): string {
  const parts: string[] = []

  if (output.interrupted) {
    parts.push('Command was interrupted (timeout/killed)')
  }

  if (output.stdout) {
    parts.push(output.stdout)
  }

  if (output.stderr) {
    parts.push(`stderr:\n${output.stderr}`)
  }

  if (output.exitCode !== 0) {
    parts.push(`Exit code: ${output.exitCode}`)
  }

  if (parts.length === 0) {
    return '(no output)'
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Tool definition factory
// ---------------------------------------------------------------------------

export function bashToolDef(): ToolDef<BashToolInput, BashToolOutput> {
  return {
    name: 'Bash',
    maxResultSizeChars: 100_000,

    get inputSchema(): ZodType<BashToolInput> {
      return z.strictObject({
        command: z.string(),
        timeout: semanticNumber(z.number().int().min(1).max(MAX_TIMEOUT_MS).optional()),
        description: z.string().optional(),
      }) as ZodType<BashToolInput>
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async checkPermissions(input): Promise<PermissionResult> {
      return checkProtectedPath(input.command, 'Command')
    },

    async prompt() {
      return (
        'Executes a shell command and returns stdout, stderr, and exit code. ' +
        'Working directory persists across calls. ' +
        'Commands that exceed the timeout are killed. ' +
        'Optional timeout in milliseconds (default 120000, max 600000).'
      )
    },

    async description(input) {
      if (input.description) return input.description
      return `$ ${truncatePreview(input.command, 80)}`
    },

    userFacingName(input) {
      return input.command ? `Bash(${truncatePreview(input.command, 40)})` : 'Bash'
    },
    renderToolUseMessage,
    renderToolResultMessage,
    renderToolUseProgressMessage,
    isResultTruncated,
    getActivityDescription,

    async call(input, context: ToolUseContext) {
      const timeoutMs = input.timeout ?? DEFAULT_TIMEOUT_MS

      return {
        data: await executeCommand(
          input.command,
          timeoutMs,
          context.abortController.signal,
          context.onProgress,
        ),
      }
    },

    mapToolResultToToolResultBlockParam(
      output: BashToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: formatResult(output),
      }
    },
  }
}
