import { describe, test, expect } from 'bun:test'
import { execCommandHook } from '../services/hooks/executor.js'
import type { CommandHook } from '../services/hooks/types.js'

function makeHook(overrides: Partial<CommandHook> = {}): CommandHook {
  return {
    type: 'command',
    command: 'echo hello',
    ...overrides,
  }
}

describe('execCommandHook', () => {
  test('executes a simple command and returns stdout', async () => {
    const hook = makeHook({ command: 'echo "hello world"' })
    const result = await execCommandHook(
      hook,
      '{}',
      new AbortController().signal,
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('hello world')
    expect(result.stderr).toBe('')
  })

  test('captures stderr', async () => {
    const hook = makeHook({ command: 'echo "error" >&2' })
    const result = await execCommandHook(
      hook,
      '{}',
      new AbortController().signal,
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('error')
  })

  test('returns non-zero exit code', async () => {
    const hook = makeHook({ command: 'exit 2' })
    const result = await execCommandHook(
      hook,
      '{}',
      new AbortController().signal,
    )
    expect(result.status).toBe(2)
  })

  test('pipes JSON input on stdin', async () => {
    // Read stdin and echo it back
    const hook = makeHook({ command: 'cat' })
    const input = JSON.stringify({ tool_name: 'Bash', command: 'ls' })
    const result = await execCommandHook(
      hook,
      input,
      new AbortController().signal,
    )
    expect(result.status).toBe(0)
    // cat will output the JSON + the trailing newline (trimmed)
    expect(result.stdout).toBe(input)
  })

  test('enforces timeout and kills the process', async () => {
    const hook = makeHook({ command: 'sleep 60', timeout: 1 })
    await expect(
      execCommandHook(hook, '{}', new AbortController().signal),
    ).rejects.toThrow('Hook timed out')
  }, 10_000)

  test('respects abort signal', async () => {
    const controller = new AbortController()
    const hook = makeHook({ command: 'sleep 60' })
    const promise = execCommandHook(
      hook,
      '{}',
      controller.signal,
    )
    // Give the process time to start, then abort
    setTimeout(() => controller.abort(), 100)
    await expect(promise).rejects.toThrow('Hook cancelled')
  }, 10_000)

  test('respects already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const hook = makeHook({ command: 'echo test' })
    await expect(
      execCommandHook(hook, '{}', controller.signal),
    ).rejects.toThrow('Hook cancelled')
  })

  test('returns JSON output from hook process', async () => {
    const hook = makeHook({
      command: 'echo \'{"decision":"block","reason":"bad command"}\'',
    })
    const result = await execCommandHook(
      hook,
      '{}',
      new AbortController().signal,
    )
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('bad command')
  })

  test('sets PA_PROJECT_DIR environment variable', async () => {
    const hook = makeHook({ command: 'echo $PA_PROJECT_DIR' })
    const result = await execCommandHook(
      hook,
      '{}',
      new AbortController().signal,
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(process.cwd())
  })

  test('uses default timeout when not specified', async () => {
    // Just verify it doesn't error for a fast command without explicit timeout
    const hook = makeHook({ command: 'echo fast' })
    const result = await execCommandHook(
      hook,
      '{}',
      new AbortController().signal,
    )
    expect(result.status).toBe(0)
  })
})
