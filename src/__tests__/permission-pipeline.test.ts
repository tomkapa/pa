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

  describe('allow rules (step 8)', () => {
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

  describe('default (step 10)', () => {
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

  describe('file pattern matching', () => {
    test('Read(src/**/*.ts) allow rule matches TypeScript files under src/', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read' }))
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Read(src/**/*.ts)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: `${process.cwd()}/src/foo.ts` },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('Edit(src/**/*.ts) deny rule blocks matching files', async () => {
      const tool = buildTool(makeToolDef({ name: 'Edit' }))
      const ctx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['Edit(*.secret)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: `${process.cwd()}/config.secret` },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })
  })

  describe('wildcard pattern matching', () => {
    test('Bash(npm *) allow rule matches npm install', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm *)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm install' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('Bash(npm *) allow rule matches npm alone', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm *)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('Bash(npm *) allow rule does not match npx', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm *)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npx create-react-app' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
    })

    test('Bash(git * main) deny rule blocks git push origin main', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['Bash(git * main)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'git push origin main' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })

    test('legacy prefix Bash(npm:*) matches npm run test', async () => {
      const tool = buildTool(makeBashToolDef())
      const ctx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm:*)'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm run test' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })
  })

  describe('read-only auto-allow (step 7)', () => {
    test('auto-allows read-only tool with file_path within CWD', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: `${process.cwd()}/src/index.ts` },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
      if (result.behavior === 'allow') {
        expect(result.reason).toEqual({
          type: 'toolSpecific',
          description: 'Read-only tool within project directory',
        })
      }
    })

    test('auto-allows read-only tool with relative path (implicitly within CWD)', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: 'src/index.ts' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('auto-allows read-only tool with no paths (e.g., TaskList)', async () => {
      const tool = buildTool(makeToolDef({ name: 'TaskList', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { value: 'hello' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
      if (result.behavior === 'allow') {
        expect(result.reason).toEqual({
          type: 'toolSpecific',
          description: 'Read-only tool with no filesystem paths',
        })
      }
    })

    test('asks for read-only tool with path outside CWD', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: '/etc/passwd' },
        ctx,
        makeContext(),
      )
      // Falls through to default ask
      expect(result.behavior).toBe('ask')
    })

    test('asks for read-only tool with UNC path', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: '\\\\server\\share\\file.txt' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
      if (result.behavior === 'ask') {
        expect(result.reason).toEqual({
          type: 'safetyCheck',
          description: 'UNC paths may leak credentials',
        })
      }
    })

    test('asks for read-only tool with tilde expansion variant', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: '~root/.bashrc' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
      if (result.behavior === 'ask') {
        expect(result.reason.type).toBe('safetyCheck')
      }
    })

    test('asks for read-only tool with shell expansion in path', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: '/tmp/$HOME/file.txt' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
      if (result.behavior === 'ask') {
        expect(result.reason.type).toBe('safetyCheck')
      }
    })

    test('asks for read-only tool targeting sensitive .env file within CWD', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: `${process.cwd()}/.env` },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
      if (result.behavior === 'ask') {
        expect(result.reason).toEqual({
          type: 'safetyCheck',
          description: 'Sensitive file path',
        })
      }
    })

    test('asks for read-only tool targeting .ssh within CWD', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: `${process.cwd()}/.ssh/id_rsa` },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
    })

    test('does not auto-allow non-read-only tools', async () => {
      const tool = buildTool(makeToolDef({ name: 'Write', isReadOnly: () => false }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: `${process.cwd()}/src/index.ts` },
        ctx,
        makeContext(),
      )
      // Should fall through to default ask, not be auto-allowed
      expect(result.behavior).toBe('ask')
    })

    test('deny rules override read-only auto-allow', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['Read'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: `${process.cwd()}/src/index.ts` },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })

    test('auto-allows Glob with path field within CWD', async () => {
      const tool = buildTool(makeToolDef({ name: 'Glob', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { pattern: '*.ts', path: `${process.cwd()}/src` },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('dangerous path check runs before CWD check (defense-in-depth)', async () => {
      // UNC path that happens to start with CWD-like prefix
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: '//server/share' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
      if (result.behavior === 'ask') {
        expect(result.reason.type).toBe('safetyCheck')
      }
    })

    test('sensitive path check runs before CWD check (defense-in-depth)', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: `${process.cwd()}/credentials.json` },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('ask')
      if (result.behavior === 'ask') {
        expect(result.reason).toEqual({
          type: 'safetyCheck',
          description: 'Sensitive file path',
        })
      }
    })

    test('home directory path is outside CWD', async () => {
      const tool = buildTool(makeToolDef({ name: 'Read', isReadOnly: () => true }))
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: '~/Documents/file.txt' },
        ctx,
        makeContext(),
      )
      // ~/Documents is outside CWD, should fall through to default ask
      expect(result.behavior).toBe('ask')
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
