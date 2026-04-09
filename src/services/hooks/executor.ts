import { spawn } from 'node:child_process'
import type { CommandHook } from './types.js'
import { DEFAULT_HOOK_TIMEOUT_SECONDS } from './types.js'

export interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

/**
 * Execute a single command hook by spawning a shell process.
 *
 * - Pipes `jsonInput` on stdin (terminated by `\n` — critical for bash `read`)
 * - Collects stdout/stderr
 * - Enforces timeout (kills with SIGTERM)
 * - Respects caller's AbortSignal
 *
 * Throws on timeout or abort (caller handles as non-blocking error).
 */
export async function execCommandHook(
  hook: CommandHook,
  jsonInput: string,
  signal: AbortSignal,
): Promise<ExecResult> {
  const timeoutMs = (hook.timeout ?? DEFAULT_HOOK_TIMEOUT_SECONDS) * 1000

  const child = spawn(hook.command, [], {
    shell: true,
    cwd: process.cwd(),
    env: {
      ...process.env,
      PA_PROJECT_DIR: process.cwd(),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // Pipe hook input as JSON on stdin, terminated by newline.
  // The newline is critical: bash `read -r line` returns exit 1 on
  // EOF-without-delimiter, even though the variable IS populated.
  // Scripts using `if read -r line; then` would skip the branch.
  child.stdin.write(jsonInput + '\n', 'utf8')
  child.stdin.end()

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (d: string) => { stdout += d })
  child.stderr.on('data', (d: string) => { stderr += d })

  const status = await Promise.race([
    new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 1))
    }),
    new Promise<number>((_, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`Hook timed out after ${timeoutMs}ms: ${hook.command}`))
      }, timeoutMs)
      // Don't keep the process alive just for this timer
      timer.unref()
      // If child exits before timeout, clear it
      child.on('close', () => clearTimeout(timer))
    }),
    new Promise<number>((_, reject) => {
      if (signal.aborted) {
        child.kill('SIGTERM')
        reject(new Error('Hook cancelled'))
        return
      }
      const onAbort = () => {
        child.kill('SIGTERM')
        reject(new Error('Hook cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      child.on('close', () => signal.removeEventListener('abort', onAbort))
    }),
  ])

  return { stdout: stdout.trim(), stderr: stderr.trim(), status }
}
