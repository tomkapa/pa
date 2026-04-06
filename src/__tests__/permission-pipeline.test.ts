import { describe, test, expect } from 'bun:test'
import { hasPermissionsToUseTool } from '../services/permissions/pipeline.js'
import { createPermissionContext } from '../services/permissions/context.js'
import { buildTool } from '../services/tools/build-tool.js'
import { makeContext } from '../testing/make-context.js'
import { makeToolDef, makeBashToolDef } from '../testing/make-tool-def.js'

// ---------------------------------------------------------------------------
// Pipeline tests
// ---------------------------------------------------------------------------

describe('hasPermissionsToUseTool', () => {
  describe('deny rules (step 1)', () => {
    test('tool-level deny blocks the tool', async () => {
      const tool = buildTool(makeToolDef())
      const ctx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['TestTool'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })

    test('content-specific deny blocks matching content', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['Bash(rm -rf /)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'rm -rf /' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })

    test('content-specific deny does not block non-matching content', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['Bash(rm -rf /)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'git status' },
        ctx,
        makeContext(),
      )
      // Should fall through to default ask
      expect(result.behavior).toBe('ask')
    })

    test('deny overrides allow rules', async () => {
      const tool = buildTool(makeToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { userSettings: ['TestTool'] },
        alwaysDenyRules: { cliArg: ['TestTool'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })

    test('deny overrides bypassPermissions mode', async () => {
      const tool = buildTool(makeToolDef())
      const ctx = createPermissionContext({
        mode: 'bypassPermissions',
        alwaysDenyRules: { userSettings: ['TestTool'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })
  })

  describe('ask rules (step 2)', () => {
    test('ask rule forces ask regardless of mode', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        mode: 'bypassPermissions',
        alwaysAskRules: { userSettings: ['Bash(npm publish)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm publish' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
    })

    test('ask rule does not match different content', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        mode: 'bypassPermissions',
        alwaysAskRules: { userSettings: ['Bash(npm publish)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'git status' },
        ctx,
        makeContext(),
      )
      // bypassPermissions should allow this
      expect(result.behavior).toBe('allow')
    })
  })

  describe('tool-specific checkPermissions (step 3)', () => {
    test('tool deny is respected', async () => {
      const tool = buildTool(
        makeToolDef({
          checkPermissions: async () => ({
            behavior: 'deny',
            reason: { type: 'toolSpecific', description: 'not allowed' },
            message: 'Tool says no',
          }),
        }),
      )
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
      if (result.behavior === 'deny') {
        expect(result.message).toBe('Tool says no')
      }
    })

    test('tool ask with bypass-immune flag survives bypassPermissions', async () => {
      const tool = buildTool(
        makeToolDef({
          checkPermissions: async () => ({
            behavior: 'ask',
            reason: { type: 'safetyCheck', description: 'protected path' },
            message: 'Safety check',
            isBypassImmune: true,
          }),
        }),
      )
      const ctx = createPermissionContext({ mode: 'bypassPermissions' })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
    })

    test('tool ask without bypass-immune is overridden by bypassPermissions', async () => {
      const tool = buildTool(
        makeToolDef({
          checkPermissions: async () => ({
            behavior: 'ask',
            reason: { type: 'toolSpecific', description: 'wants confirmation' },
            message: 'Confirm?',
          }),
        }),
      )
      const ctx = createPermissionContext({ mode: 'bypassPermissions' })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('tool passthrough defers to later pipeline stages', async () => {
      const tool = buildTool(
        makeToolDef({
          checkPermissions: async () => ({
            behavior: 'passthrough',
          }),
        }),
      )
      const ctx = createPermissionContext({
        alwaysAllowRules: { userSettings: ['TestTool'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })
  })

  describe('bypassPermissions mode (step 5)', () => {
    test('allows everything when no rules block it', async () => {
      const tool = buildTool(makeToolDef())
      const ctx = createPermissionContext({ mode: 'bypassPermissions' })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })
  })

  describe('allow rules (step 6)', () => {
    test('tool-level allow auto-allows', async () => {
      const tool = buildTool(makeToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { userSettings: ['TestTool'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('content-specific allow auto-allows matching content', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(git status)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'git status' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('content-specific allow does not match different content', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(git status)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'rm -rf /' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
    })
  })

  describe('default (step 7)', () => {
    test('defaults to ask when nothing matches', async () => {
      const tool = buildTool(makeToolDef())
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
      if (result.behavior === 'ask') {
        expect(result.reason).toEqual({ type: 'default' })
      }
    })
  })

  describe('plan mode', () => {
    test('allows read-only tools', async () => {
      const tool = buildTool(makeToolDef({ isReadOnly: () => true }))
      const ctx = createPermissionContext({ mode: 'plan' })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('denies write tools', async () => {
      const tool = buildTool(makeToolDef({ isReadOnly: () => false }))
      const ctx = createPermissionContext({ mode: 'plan' })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })
  })

  describe('content extraction', () => {
    test('uses command field for Bash rule matching', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(git status)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'git status' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('uses file_path field for file tool rule matching', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read' }))
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Read(src/foo.ts)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: 'src/foo.ts' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })
  })

  describe('MCP tool matching', () => {
    test('server-level deny blocks all tools from that server', async () => {
      const tool = buildTool(makeToolDef({ name: 'mcp__server1__tool1' }))
      const ctx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['mcp__server1'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })

    test('server-level allow allows all tools from that server', async () => {
      const tool = buildTool(makeToolDef({ name: 'mcp__server1__tool1' }))
      const ctx = createPermissionContext({
        alwaysAllowRules: { userSettings: ['mcp__server1'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })
  })
})
