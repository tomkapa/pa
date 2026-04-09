import { describe, test, expect } from 'bun:test'
import {
  CommandHookSchema,
  HookMatcherSchema,
  HooksSettingsSchema,
  SyncHookResponseSchema,
  HOOK_EVENTS,
} from '../services/hooks/types.js'

describe('Hook type schemas', () => {
  describe('HOOK_EVENTS', () => {
    test('contains all four event types', () => {
      expect(HOOK_EVENTS).toEqual([
        'PreToolUse',
        'PostToolUse',
        'SessionStart',
        'UserPromptSubmit',
      ])
    })
  })

  describe('CommandHookSchema', () => {
    test('accepts valid command hook', () => {
      const result = CommandHookSchema.safeParse({
        type: 'command',
        command: 'echo hello',
      })
      expect(result.success).toBe(true)
    })

    test('accepts command with optional fields', () => {
      const result = CommandHookSchema.safeParse({
        type: 'command',
        command: 'python3 ~/hooks/lint.py',
        timeout: 30,
        statusMessage: 'Running linter...',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.timeout).toBe(30)
        expect(result.data.statusMessage).toBe('Running linter...')
      }
    })

    test('rejects empty command', () => {
      const result = CommandHookSchema.safeParse({
        type: 'command',
        command: '',
      })
      expect(result.success).toBe(false)
    })

    test('rejects wrong type', () => {
      const result = CommandHookSchema.safeParse({
        type: 'http',
        command: 'echo hello',
      })
      expect(result.success).toBe(false)
    })

    test('rejects missing command', () => {
      const result = CommandHookSchema.safeParse({ type: 'command' })
      expect(result.success).toBe(false)
    })

    test('rejects extra fields (strict)', () => {
      const result = CommandHookSchema.safeParse({
        type: 'command',
        command: 'echo hello',
        extraField: true,
      })
      expect(result.success).toBe(false)
    })

    test('rejects negative timeout', () => {
      const result = CommandHookSchema.safeParse({
        type: 'command',
        command: 'echo hello',
        timeout: -1,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('HookMatcherSchema', () => {
    test('accepts matcher with hooks', () => {
      const result = HookMatcherSchema.safeParse({
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'echo test' }],
      })
      expect(result.success).toBe(true)
    })

    test('accepts without matcher (wildcard)', () => {
      const result = HookMatcherSchema.safeParse({
        hooks: [{ type: 'command', command: 'echo test' }],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.matcher).toBeUndefined()
      }
    })

    test('rejects empty hooks array', () => {
      const result = HookMatcherSchema.safeParse({
        matcher: 'Bash',
        hooks: [],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('HooksSettingsSchema', () => {
    test('accepts valid hooks config', () => {
      const result = HooksSettingsSchema.safeParse({
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo test' }],
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('accepts empty config', () => {
      const result = HooksSettingsSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    test('accepts undefined', () => {
      const result = HooksSettingsSchema.safeParse(undefined)
      expect(result.success).toBe(true)
    })

    test('accepts multiple events', () => {
      const result = HooksSettingsSchema.safeParse({
        PreToolUse: [
          { hooks: [{ type: 'command', command: 'echo pre' }] },
        ],
        PostToolUse: [
          { hooks: [{ type: 'command', command: 'echo post' }] },
        ],
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [{ type: 'command', command: 'echo start' }],
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('rejects unknown event names', () => {
      const result = HooksSettingsSchema.safeParse({
        UnknownEvent: [
          { hooks: [{ type: 'command', command: 'echo test' }] },
        ],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('SyncHookResponseSchema', () => {
    test('accepts empty response', () => {
      const result = SyncHookResponseSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    test('accepts top-level decision', () => {
      const result = SyncHookResponseSchema.safeParse({
        decision: 'block',
        reason: 'Dangerous command',
      })
      expect(result.success).toBe(true)
    })

    test('accepts continue: false', () => {
      const result = SyncHookResponseSchema.safeParse({
        continue: false,
        stopReason: 'User limit reached',
      })
      expect(result.success).toBe(true)
    })

    test('accepts PreToolUse hookSpecificOutput', () => {
      const result = SyncHookResponseSchema.safeParse({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'Command not allowed',
        },
      })
      expect(result.success).toBe(true)
    })

    test('accepts PostToolUse hookSpecificOutput', () => {
      const result = SyncHookResponseSchema.safeParse({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: 'Tool output was logged',
        },
      })
      expect(result.success).toBe(true)
    })

    test('accepts extra fields (passthrough)', () => {
      const result = SyncHookResponseSchema.safeParse({
        decision: 'approve',
        customField: 'custom value',
      })
      expect(result.success).toBe(true)
    })
  })
})
