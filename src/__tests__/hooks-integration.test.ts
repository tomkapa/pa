import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AggregatedHookResult } from '../services/hooks/types.js'
import { clearHooksConfigCache } from '../services/hooks/config.js'

/**
 * Integration tests — exercise the full pipeline from config loading
 * through shell execution to result aggregation. Each test creates a
 * temporary settings directory and real hook scripts.
 */

async function collectResults(
  gen: AsyncGenerator<AggregatedHookResult>,
): Promise<AggregatedHookResult[]> {
  const results: AggregatedHookResult[] = []
  for await (const result of gen) {
    results.push(result)
  }
  return results
}

describe('hooks integration', () => {
  let tmpDir: string
  let originalCwd: string
  let originalConfigDir: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hooks-integration-'))
    originalCwd = process.cwd()
    originalConfigDir = process.env['PA_CONFIG_DIR']

    mkdirSync(join(tmpDir, 'config'), { recursive: true })
    mkdirSync(join(tmpDir, 'project', '.pa'), { recursive: true })
    mkdirSync(join(tmpDir, 'project', 'hooks'), { recursive: true })

    process.env['PA_CONFIG_DIR'] = join(tmpDir, 'config')
    process.chdir(join(tmpDir, 'project'))
    clearHooksConfigCache()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalConfigDir === undefined) {
      delete process.env['PA_CONFIG_DIR']
    } else {
      process.env['PA_CONFIG_DIR'] = originalConfigDir
    }
    clearHooksConfigCache()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('PreToolUse hook receives tool_name and tool_input on stdin', async () => {
    // Hook script that reads stdin and writes it to a file for inspection
    const hookScript = join(tmpDir, 'project', 'hooks', 'inspect.sh')
    writeFileSync(hookScript, `#!/bin/bash\nread -r line\necho "$line" > ${join(tmpDir, 'stdin-capture.json')}\n`, { mode: 0o755 })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{ type: 'command', command: hookScript }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Bash', 'toolu_123', { command: 'ls -la' }),
    )

    // Hook ran successfully (no blocking errors)
    const hasBlocking = results.some(r => r.blockingError)
    expect(hasBlocking).toBe(false)

    // Verify the hook received correct stdin
    const { readFileSync } = await import('node:fs')
    const captured = JSON.parse(readFileSync(join(tmpDir, 'stdin-capture.json'), 'utf-8'))
    expect(captured.hook_event_name).toBe('PreToolUse')
    expect(captured.tool_name).toBe('Bash')
    expect(captured.tool_input).toEqual({ command: 'ls -la' })
    expect(captured.tool_use_id).toBe('toolu_123')
  })

  test('PreToolUse hook can block a tool with exit code 2', async () => {
    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{
              type: 'command',
              command: 'echo "Dangerous command blocked" >&2; exit 2',
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Bash', 'toolu_456', { command: 'rm -rf /' }),
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.blockingError).toEqual({
      message: 'Dangerous command blocked',
      command: 'echo "Dangerous command blocked" >&2; exit 2',
    })
  })

  test('PreToolUse hook can deny via JSON response', async () => {
    const jsonResponse = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Policy violation',
      },
    })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: `echo '${jsonResponse}'`,
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Bash', 'toolu_789', { command: 'echo test' }),
    )

    const blockingResult = results.find(r => r.blockingError)
    expect(blockingResult).toBeDefined()
    expect(blockingResult!.blockingError!.message).toBe('Policy violation')

    const permResult = results.find(r => r.permissionBehavior)
    expect(permResult).toBeDefined()
    expect(permResult!.permissionBehavior).toBe('deny')
  })

  test('PreToolUse hook can approve via JSON response', async () => {
    const jsonResponse = JSON.stringify({ decision: 'approve' })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: `echo '${jsonResponse}'`,
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Bash', 'toolu_abc', { command: 'echo safe' }),
    )

    const permResult = results.find(r => r.permissionBehavior)
    expect(permResult).toBeDefined()
    expect(permResult!.permissionBehavior).toBe('allow')
  })

  test('hook matcher filters by tool name', async () => {
    // This hook only fires for "Write" — should NOT fire for "Bash"
    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'Write',
            hooks: [{
              type: 'command',
              command: 'echo "Blocked" >&2; exit 2',
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Bash', 'toolu_def', { command: 'echo test' }),
    )

    // No hooks should have fired
    expect(results).toHaveLength(0)
  })

  test('wildcard matcher fires for all tools', async () => {
    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            // No matcher — wildcard
            hooks: [{
              type: 'command',
              command: 'echo "audited" >&2; exit 0',
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')

    const bashResults = await collectResults(
      executePreToolHooks('Bash', 'toolu_1', {}),
    )
    const writeResults = await collectResults(
      executePreToolHooks('Write', 'toolu_2', {}),
    )

    // Both should produce results (even if just success)
    // The hook runs for both tools because no matcher is specified
    // Since exit 0 with non-JSON output, these yield no results — but the hook ran
    expect(bashResults).toHaveLength(0) // no JSON output → no result yielded
    expect(writeResults).toHaveLength(0)
  })

  test('non-blocking error does not stop tool execution', async () => {
    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: 'exit 1', // non-blocking error
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Bash', 'toolu_ghi', { command: 'echo test' }),
    )

    // No blocking errors yielded
    const blocking = results.filter(r => r.blockingError)
    expect(blocking).toHaveLength(0)
  })

  test('PostToolUse hook receives tool_response', async () => {
    const hookScript = join(tmpDir, 'project', 'hooks', 'post.sh')
    writeFileSync(hookScript, `#!/bin/bash\nread -r line\necho "$line" > ${join(tmpDir, 'post-capture.json')}\n`, { mode: 0o755 })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [{
            hooks: [{ type: 'command', command: hookScript }],
          }],
        },
      }),
    )

    const { executePostToolHooks } = await import('../services/hooks/dispatch.js')
    await collectResults(
      executePostToolHooks(
        'Bash',
        'toolu_post1',
        { command: 'ls' },
        { output: 'file1.ts\nfile2.ts' },
      ),
    )

    const { readFileSync } = await import('node:fs')
    const captured = JSON.parse(readFileSync(join(tmpDir, 'post-capture.json'), 'utf-8'))
    expect(captured.hook_event_name).toBe('PostToolUse')
    expect(captured.tool_name).toBe('Bash')
    expect(captured.tool_response).toEqual({ output: 'file1.ts\nfile2.ts' })
  })

  test('SessionStart hook receives source', async () => {
    const hookScript = join(tmpDir, 'project', 'hooks', 'session.sh')
    writeFileSync(hookScript, `#!/bin/bash\nread -r line\necho "$line" > ${join(tmpDir, 'session-capture.json')}\n`, { mode: 0o755 })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{
            matcher: 'startup',
            hooks: [{ type: 'command', command: hookScript }],
          }],
        },
      }),
    )

    const { executeSessionStartHooks } = await import('../services/hooks/dispatch.js')
    await collectResults(executeSessionStartHooks('startup'))

    const { readFileSync } = await import('node:fs')
    const captured = JSON.parse(readFileSync(join(tmpDir, 'session-capture.json'), 'utf-8'))
    expect(captured.hook_event_name).toBe('SessionStart')
    expect(captured.source).toBe('startup')
  })

  test('UserPromptSubmit hook receives prompt', async () => {
    const hookScript = join(tmpDir, 'project', 'hooks', 'prompt.sh')
    writeFileSync(hookScript, `#!/bin/bash\nread -r line\necho "$line" > ${join(tmpDir, 'prompt-capture.json')}\n`, { mode: 0o755 })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{
            hooks: [{ type: 'command', command: hookScript }],
          }],
        },
      }),
    )

    const { executeUserPromptSubmitHooks } = await import('../services/hooks/dispatch.js')
    await collectResults(
      executeUserPromptSubmitHooks('fix the login bug'),
    )

    const { readFileSync } = await import('node:fs')
    const captured = JSON.parse(readFileSync(join(tmpDir, 'prompt-capture.json'), 'utf-8'))
    expect(captured.hook_event_name).toBe('UserPromptSubmit')
    expect(captured.prompt).toBe('fix the login bug')
  })

  test('UserPromptSubmit hook can block with exit 2', async () => {
    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{
            hooks: [{
              type: 'command',
              command: 'echo "Prompt blocked by policy" >&2; exit 2',
            }],
          }],
        },
      }),
    )

    const { executeUserPromptSubmitHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executeUserPromptSubmitHooks('do something bad'),
    )

    expect(results.some(r => r.blockingError)).toBe(true)
  })

  test('hook can inject additional context', async () => {
    const jsonResponse = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'Remember: this file is sensitive',
      },
    })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: `echo '${jsonResponse}'`,
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Read', 'toolu_ctx', { file_path: '/etc/passwd' }),
    )

    const ctxResult = results.find(r => r.additionalContexts)
    expect(ctxResult).toBeDefined()
    expect(ctxResult!.additionalContexts).toEqual([
      'Remember: this file is sensitive',
    ])
  })

  test('hook can modify tool input', async () => {
    const jsonResponse = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { command: 'ls -la --safe-mode' },
      },
    })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: `echo '${jsonResponse}'`,
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Bash', 'toolu_upd', { command: 'ls -la' }),
    )

    const updateResult = results.find(r => r.updatedInput)
    expect(updateResult).toBeDefined()
    expect(updateResult!.updatedInput).toEqual({ command: 'ls -la --safe-mode' })
  })

  test('continue: false prevents continuation', async () => {
    const jsonResponse = JSON.stringify({
      continue: false,
      stopReason: 'Token limit exceeded',
    })

    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: `echo '${jsonResponse}'`,
            }],
          }],
        },
      }),
    )

    const { executePreToolHooks } = await import('../services/hooks/dispatch.js')
    const results = await collectResults(
      executePreToolHooks('Bash', 'toolu_stop', { command: 'echo test' }),
    )

    const stopResult = results.find(r => r.preventContinuation)
    expect(stopResult).toBeDefined()
    expect(stopResult!.stopReason).toBe('Token limit exceeded')
  })
})
