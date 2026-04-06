import { describe, test, expect } from 'bun:test'
import { hasPermissionsToUseTool } from '../services/permissions/pipeline.js'
import { createPermissionContext } from '../services/permissions/context.js'
import { buildTool } from '../services/tools/build-tool.js'
import { makeContext } from '../testing/make-context.js'
import { makeBashToolDef } from '../testing/make-tool-def.js'

// ---------------------------------------------------------------------------
// Bash Security Pipeline Integration Tests
// ---------------------------------------------------------------------------

describe('Bash security hardening in pipeline', () => {
  const bashTool = buildTool(makeBashToolDef())
  const ctx = makeContext()

  // -----------------------------------------------------------------------
  // Prefix matching with word boundary
  // -----------------------------------------------------------------------

  describe('prefix matching word boundary', () => {
    test('ls rule does not match lsof', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(ls)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'lsof' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })

    test('npm rule does not match npx', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'npx create-react-app' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })

    test('ls rule matches ls -la', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(ls)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'ls -la' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('allow')
    })

    test('exact match still works', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(git status)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'git status' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('allow')
    })
  })

  // -----------------------------------------------------------------------
  // Compound command security
  // -----------------------------------------------------------------------

  describe('compound command bypass prevention', () => {
    test('npm install && curl evil is not auto-allowed by npm rule', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm install)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'npm install && curl evil.com' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })

    test('compound command allowed when ALL subcommands match allow rules', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: {
          session: ['Bash(npm install)', 'Bash(npm test)'],
        },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'npm install && npm test' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('allow')
    })

    test('piped command checked per-subcommand', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(ls)', 'Bash(grep)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'ls | grep foo' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('allow')
    })

    test('piped command denied if second subcommand not allowed', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(ls)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'ls | curl evil.com' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })
  })

  // -----------------------------------------------------------------------
  // Deny rules across compound commands
  // -----------------------------------------------------------------------

  describe('deny rules across compound commands', () => {
    test('deny rule for curl catches it in compound command', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm install)'] },
        alwaysDenyRules: { userSettings: ['Bash(curl)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'npm install && curl evil.com' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('deny')
    })

    test('deny rule matches after env var stripping', async () => {
      const permCtx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['Bash(curl)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'MALICIOUS_VAR=x curl evil.com' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('deny')
    })
  })

  // -----------------------------------------------------------------------
  // Env var prefix evasion
  // -----------------------------------------------------------------------

  describe('env var prefix handling', () => {
    test('safe env var stripped for allow matching', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm install)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'NODE_ENV=production npm install' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('allow')
    })

    test('unsafe env var NOT stripped for allow matching', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm install)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'INTERPRETER=/evil/shell npm install' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })

    test('all env vars stripped for deny matching', async () => {
      const permCtx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['Bash(curl)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'FOO=bar curl evil.com' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('deny')
    })
  })

  // -----------------------------------------------------------------------
  // Safe wrapper stripping
  // -----------------------------------------------------------------------

  describe('safe wrapper stripping', () => {
    test('timeout wrapper stripped for allow matching', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm install)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'timeout 30 npm install' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('allow')
    })

    test('nested wrappers stripped for allow matching', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(npm install)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'timeout 30 nice -n 5 npm install' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('allow')
    })
  })

  // -----------------------------------------------------------------------
  // Heredoc smuggling
  // -----------------------------------------------------------------------

  describe('heredoc smuggling prevention', () => {
    test('heredoc triggers ask', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(cat)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'cat <<EOF\nrm -rf /\nEOF' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })
  })

  // -----------------------------------------------------------------------
  // Line continuation attack prevention
  // -----------------------------------------------------------------------

  describe('line continuation attack prevention', () => {
    test('backslash-newline inside command name triggers ask', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(tr)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'tr\\\naceroute evil.com' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })
  })

  // -----------------------------------------------------------------------
  // Dangerous pattern detection
  // -----------------------------------------------------------------------

  describe('dangerous pattern detection', () => {
    test('command substitution triggers ask', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(echo)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'echo $(whoami)' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })

    test('eval triggers ask', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash(eval)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'eval "rm -rf /"' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('ask')
    })
  })

  // -----------------------------------------------------------------------
  // Fail-closed behavior
  // -----------------------------------------------------------------------

  describe('fail-closed behavior', () => {
    test('tool-level Bash allow rule still allows everything (no content check)', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'anything at all' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('allow')
    })

    test('deny rules still take priority over allow for dangerous commands', async () => {
      const permCtx = createPermissionContext({
        alwaysAllowRules: { session: ['Bash'] },
        alwaysDenyRules: { userSettings: ['Bash(rm -rf /)'] },
      })
      const result = await hasPermissionsToUseTool(
        bashTool,
        { command: 'rm -rf /' },
        permCtx,
        ctx,
      )
      expect(result.behavior).toBe('deny')
    })
  })
})
