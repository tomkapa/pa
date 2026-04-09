import { describe, test, expect } from 'bun:test'
import { processHookResult } from '../services/hooks/orchestrator.js'
import type { CommandHook } from '../services/hooks/types.js'

function makeHook(command = 'test-hook'): CommandHook {
  return { type: 'command', command }
}

// ---------------------------------------------------------------------------
// processHookResult
// ---------------------------------------------------------------------------

describe('processHookResult', () => {
  describe('exit code handling', () => {
    test('exit 2 returns blocking error with stderr', () => {
      const result = processHookResult(
        makeHook('my-hook'),
        '',
        'Command not allowed',
        2,
      )
      expect(result.outcome).toBe('blocking')
      expect(result.blockingError).toEqual({
        message: 'Command not allowed',
        command: 'my-hook',
      })
    })

    test('exit 2 with empty stderr uses default message', () => {
      const result = processHookResult(makeHook(), '', '', 2)
      expect(result.outcome).toBe('blocking')
      expect(result.blockingError?.message).toBe('Blocked by hook')
    })

    test('exit 1 returns non-blocking error', () => {
      const result = processHookResult(makeHook(), '', 'some error', 1)
      expect(result.outcome).toBe('non_blocking_error')
      expect(result.blockingError).toBeUndefined()
    })

    test('exit 3 returns non-blocking error', () => {
      const result = processHookResult(makeHook(), '', '', 3)
      expect(result.outcome).toBe('non_blocking_error')
    })

    test('exit 0 with no stdout returns success', () => {
      const result = processHookResult(makeHook(), '', '', 0)
      expect(result.outcome).toBe('success')
    })
  })

  describe('JSON response parsing', () => {
    test('exit 0 with non-JSON stdout returns success', () => {
      const result = processHookResult(
        makeHook(),
        'plain text output',
        '',
        0,
      )
      expect(result.outcome).toBe('success')
    })

    test('exit 0 with invalid JSON returns success', () => {
      const result = processHookResult(
        makeHook(),
        '{invalid json',
        '',
        0,
      )
      expect(result.outcome).toBe('success')
    })

    test('exit 0 with empty JSON object returns success', () => {
      const result = processHookResult(makeHook(), '{}', '', 0)
      expect(result.outcome).toBe('success')
    })
  })

  describe('top-level decision shorthand', () => {
    test('decision: block → deny with blocking error', () => {
      const result = processHookResult(
        makeHook('blocker'),
        JSON.stringify({ decision: 'block', reason: 'not allowed' }),
        '',
        0,
      )
      expect(result.outcome).toBe('blocking')
      expect(result.permissionBehavior).toBe('deny')
      expect(result.blockingError).toEqual({
        message: 'not allowed',
        command: 'blocker',
      })
    })

    test('decision: block without reason uses default', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({ decision: 'block' }),
        '',
        0,
      )
      expect(result.blockingError?.message).toBe('Blocked by hook')
    })

    test('decision: approve → allow', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({ decision: 'approve' }),
        '',
        0,
      )
      expect(result.outcome).toBe('success')
      expect(result.permissionBehavior).toBe('allow')
    })
  })

  describe('continue: false', () => {
    test('sets preventContinuation', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({ continue: false, stopReason: 'limit reached' }),
        '',
        0,
      )
      expect(result.preventContinuation).toBe(true)
      expect(result.stopReason).toBe('limit reached')
    })
  })

  describe('hookSpecificOutput — PreToolUse', () => {
    test('permissionDecision: deny', () => {
      const result = processHookResult(
        makeHook('deny-hook'),
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'Dangerous command',
          },
        }),
        '',
        0,
      )
      expect(result.outcome).toBe('blocking')
      expect(result.permissionBehavior).toBe('deny')
      expect(result.hookPermissionDecisionReason).toBe('Dangerous command')
      expect(result.blockingError?.message).toBe('Dangerous command')
    })

    test('permissionDecision: allow', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
          },
        }),
        '',
        0,
      )
      expect(result.permissionBehavior).toBe('allow')
    })

    test('permissionDecision: ask', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: 'Needs review',
          },
        }),
        '',
        0,
      )
      expect(result.permissionBehavior).toBe('ask')
      expect(result.hookPermissionDecisionReason).toBe('Needs review')
    })

    test('updatedInput is captured', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            updatedInput: { command: 'safe-command' },
          },
        }),
        '',
        0,
      )
      expect(result.updatedInput).toEqual({ command: 'safe-command' })
    })

    test('additionalContext is captured', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: 'Be careful with this tool',
          },
        }),
        '',
        0,
      )
      expect(result.additionalContext).toBe('Be careful with this tool')
    })
  })

  describe('hookSpecificOutput — PostToolUse', () => {
    test('additionalContext is captured', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: 'Output was logged',
          },
        }),
        '',
        0,
      )
      expect(result.additionalContext).toBe('Output was logged')
    })
  })

  describe('hookSpecificOutput — SessionStart', () => {
    test('additionalContext is captured', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'Environment loaded',
          },
        }),
        '',
        0,
      )
      expect(result.additionalContext).toBe('Environment loaded')
    })
  })

  describe('hookSpecificOutput — UserPromptSubmit', () => {
    test('additionalContext is captured', () => {
      const result = processHookResult(
        makeHook(),
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: 'Prompt augmented',
          },
        }),
        '',
        0,
      )
      expect(result.additionalContext).toBe('Prompt augmented')
    })
  })
})
