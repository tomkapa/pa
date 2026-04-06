import { execFile } from 'node:child_process'
import { platform } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Resolve rg binary path reliably (bun's global cache can make rgPath stale)
function resolveRgPath(): string {
  const require = createRequire(import.meta.url)
  const pkgMain = require.resolve('@vscode/ripgrep')
  return join(dirname(pkgMain), '..', 'bin', 'rg')
}

const rgBinary = resolveRgPath()

const DEFAULT_TIMEOUT_MS = 20_000
const WSL_TIMEOUT_MS = 60_000
const MAX_BUFFER_BYTES = 20 * 1024 * 1024 // 20 MB

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RipgrepError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message)
    this.name = 'RipgrepError'
  }
}

export class RipgrepTimeoutError extends Error {
  constructor(
    message: string,
    public readonly partialResults: string[],
  ) {
    super(message)
    this.name = 'RipgrepTimeoutError'
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMEOUT_MS = platform() === 'linux' && process.env.WSL_DISTRO_NAME !== undefined
  ? WSL_TIMEOUT_MS
  : DEFAULT_TIMEOUT_MS

function parseLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.length > 0)
}

function isEAGAIN(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EAGAIN'
  )
}

// ---------------------------------------------------------------------------
// Core ripgrep execution
// ---------------------------------------------------------------------------

/**
 * Execute ripgrep with the given arguments.
 *
 * - Uses `execFile` (not `exec`) to avoid shell injection.
 * - Exit code 0 = matches found, 1 = no matches (both success), 2 = error.
 * - Retries once with `-j 1` on EAGAIN (resource-constrained environments).
 * - On timeout with partial results, returns what was captured.
 * - On timeout with no results, throws `RipgrepTimeoutError`.
 */
export async function ripGrep(
  args: string[],
  targetDir: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  return execRipgrep(args, targetDir, abortSignal, false)
}

async function execRipgrep(
  args: string[],
  targetDir: string,
  abortSignal: AbortSignal,
  isRetry: boolean,
): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    if (abortSignal.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const finalArgs = isRetry ? ['-j', '1', ...args] : args
    const timeoutMs = TIMEOUT_MS

    const child = execFile(
      rgBinary,
      finalArgs,
      {
        cwd: targetDir,
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
      },
      (error, stdout, _stderr) => {
        // Handle abort
        if (abortSignal.aborted) {
          reject(new Error('Aborted'))
          return
        }

        // No error — matches found (exit code 0)
        if (!error) {
          resolve(parseLines(stdout))
          return
        }

        // Timeout — return partial results or throw
        if ('killed' in error && error.killed) {
          const partial = parseLines(stdout)
          if (partial.length > 0) {
            // Drop last potentially-incomplete line
            partial.pop()
            resolve(partial)
          } else {
            reject(
              new RipgrepTimeoutError(
                `ripgrep timed out after ${timeoutMs}ms with no results`,
                [],
              ),
            )
          }
          return
        }

        // EAGAIN — retry once with single-threaded mode
        if (isEAGAIN(error) && !isRetry) {
          execRipgrep(args, targetDir, abortSignal, true).then(resolve, reject)
          return
        }

        // Exit code 1 = no matches (success, not an error)
        const exitCode = 'code' in error ? (error as { code: number }).code : -1
        if (exitCode === 1) {
          resolve([])
          return
        }

        // Exit code 2+ = ripgrep usage/internal error
        reject(new RipgrepError(error.message, exitCode))
      },
    )

    // Wire up AbortSignal to kill child process
    const onAbort = () => {
      child.kill('SIGKILL')
    }
    abortSignal.addEventListener('abort', onAbort, { once: true })

    child.on('close', () => {
      abortSignal.removeEventListener('abort', onAbort)
    })
  })
}
