import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

// Captured at import time: `pa` may spawn subprocesses that overwrite
// `process.env.TMUX` later, so the only reliable signal that *this* process
// was started inside tmux is the value present here. `tmux display-message`
// is NOT equivalent — it succeeds whenever any tmux server is reachable.
let originalTmux: string | undefined = process.env['TMUX']

export function isInsideTmux(): boolean {
  return !!originalTmux
}

export interface TmuxExecResult {
  stdout: string
  stderr: string
}

export type TmuxExec = (args: string[]) => Promise<TmuxExecResult>

const execFileAsync = promisify(execFile)

const defaultTmuxExec: TmuxExec = async (args) => {
  const { stdout, stderr } = await execFileAsync('tmux', args)
  return { stdout, stderr }
}

let tmuxExec: TmuxExec = defaultTmuxExec

/**
 * Create a new tmux window for a teammate and return its window id (e.g. "@5").
 * Uses `new-window -d` so the leader stays focused on its own window; the
 * user switches to the teammate via `<prefix> n` / `<prefix> <index>`.
 */
export async function createTeammateWindow(name: string): Promise<string> {
  let result: TmuxExecResult
  try {
    result = await tmuxExec(['new-window', '-d', '-n', name, '-P', '-F', '#{window_id}'])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`tmux new-window failed: ${msg}`)
  }
  const windowId = result.stdout.trim()
  if (!windowId) {
    throw new Error('tmux new-window returned empty window id')
  }
  return windowId
}

export async function sendCommandToWindow(windowId: string, command: string): Promise<void> {
  try {
    await tmuxExec(['send-keys', '-t', windowId, command, 'Enter'])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`tmux send-keys to ${windowId} failed: ${msg}`)
  }
}

// Orphaned teammate windows keep burning tokens after the leader exits, so
// every tracked window is killed on process exit. The handler is registered
// lazily so idle / test runs don't accumulate listeners.
const spawnedWindows = new Map<string, string>()
let cleanupRegistered = false
let cleanupFired = false

export function trackWindow(agentId: string, windowId: string): void {
  spawnedWindows.set(agentId, windowId)
  registerCleanupOnce()
}

export async function killTeammateWindow(agentId: string): Promise<boolean> {
  const windowId = spawnedWindows.get(agentId)
  if (!windowId) return false
  spawnedWindows.delete(agentId)
  try {
    await tmuxExec(['kill-window', '-t', windowId])
    return true
  } catch {
    return false
  }
}

// 'exit' is synchronous — any async child we spawn here isn't guaranteed to
// reach tmux before the process dies. execFileSync blocks until the kill
// completes (round-trip to the local tmux server is sub-ms).
function killAllOnExit(): void {
  if (cleanupFired) return
  cleanupFired = true
  for (const windowId of spawnedWindows.values()) {
    try {
      execFileSync('tmux', ['kill-window', '-t', windowId], { stdio: 'ignore' })
    } catch {
      // window already gone or tmux unreachable — nothing we can do at exit
    }
  }
}

function registerCleanupOnce(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true
  process.on('exit', killAllOnExit)
}

// Test-only hooks. Not re-exported from the teams barrel.
export function __setTmuxEnvForTests(env: { tmux?: string | undefined }): void {
  originalTmux = env.tmux
}

export function __setTmuxExecForTests(exec: TmuxExec | null): void {
  tmuxExec = exec ?? defaultTmuxExec
}

export function __resetTmuxForTests(): void {
  spawnedWindows.clear()
  tmuxExec = defaultTmuxExec
  originalTmux = undefined
  if (cleanupRegistered) {
    process.off('exit', killAllOnExit)
    cleanupRegistered = false
  }
  cleanupFired = false
}

export function __getTrackedWindowForTests(agentId: string): string | undefined {
  return spawnedWindows.get(agentId)
}
