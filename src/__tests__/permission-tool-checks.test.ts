import { describe, test, expect } from 'bun:test'
import { hasPermissionsToUseTool } from '../services/permissions/pipeline.js'
import { createPermissionContext } from '../services/permissions/context.js'
import { buildTool } from '../services/tools/build-tool.js'
import { bashToolDef } from '../tools/bashTool.js'
import { writeToolDef } from '../tools/writeTool.js'
import { editToolDef } from '../tools/editTool.js'
import { readToolDef } from '../tools/readTool.js'
import { globToolDef } from '../tools/globTool.js'
import { grepToolDef } from '../tools/grepTool.js'
import { FileStateCache } from '../utils/fileStateCache.js'
import { makeContext } from '../testing/make-context.js'

const fileStateCache = new FileStateCache()

// ---------------------------------------------------------------------------
// Bash tool permission checks
// ---------------------------------------------------------------------------

describe('Bash tool permissions', () => {
  const bash = buildTool(bashToolDef())

  test('default mode asks for any command', async () => {
    const ctx = createPermissionContext({ mode: 'default' })
    const result = await hasPermissionsToUseTool(
      bash,
      { command: 'ls -la' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('acceptEdits mode auto-allows filesystem commands', async () => {
    const ctx = createPermissionContext({ mode: 'acceptEdits' })

    for (const cmd of ['mkdir -p /tmp/test', 'touch file.txt', 'rm old.txt', 'rmdir empty/', 'mv a b', 'cp a b', 'sed -i s/a/b/ file.txt']) {
      const result = await hasPermissionsToUseTool(
        bash,
        { command: cmd },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    }
  })

  test('acceptEdits mode asks for non-filesystem commands', async () => {
    const ctx = createPermissionContext({ mode: 'acceptEdits' })
    const result = await hasPermissionsToUseTool(
      bash,
      { command: 'npm publish' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('safety check: commands touching .git/ always ask (even in bypassPermissions)', async () => {
    const ctx = createPermissionContext({ mode: 'bypassPermissions' })
    const result = await hasPermissionsToUseTool(
      bash,
      { command: 'rm -rf .git/hooks' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('safety check: commands touching .claude/ always ask (even in bypassPermissions)', async () => {
    const ctx = createPermissionContext({ mode: 'bypassPermissions' })
    const result = await hasPermissionsToUseTool(
      bash,
      { command: 'cat .claude/settings.json' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('bypassPermissions allows non-sensitive commands', async () => {
    const ctx = createPermissionContext({ mode: 'bypassPermissions' })
    const result = await hasPermissionsToUseTool(
      bash,
      { command: 'git status' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })

  test('plan mode denies all bash commands', async () => {
    const ctx = createPermissionContext({ mode: 'plan' })
    const result = await hasPermissionsToUseTool(
      bash,
      { command: 'ls' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('deny')
  })
})

// ---------------------------------------------------------------------------
// Write tool permission checks
// ---------------------------------------------------------------------------

describe('Write tool permissions', () => {
  const write = buildTool(writeToolDef(fileStateCache))

  test('safety check: writing to .git/ always asks', async () => {
    const ctx = createPermissionContext({ mode: 'bypassPermissions' })
    const result = await hasPermissionsToUseTool(
      write,
      { file_path: '.git/config', content: 'bad' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('safety check: writing to .claude/ always asks', async () => {
    const ctx = createPermissionContext({ mode: 'bypassPermissions' })
    const result = await hasPermissionsToUseTool(
      write,
      { file_path: '.claude/settings.json', content: '{}' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('acceptEdits mode auto-allows writes to non-protected paths', async () => {
    const ctx = createPermissionContext({ mode: 'acceptEdits' })
    const result = await hasPermissionsToUseTool(
      write,
      { file_path: 'src/foo.ts', content: 'hello' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })

  test('plan mode denies writes', async () => {
    const ctx = createPermissionContext({ mode: 'plan' })
    const result = await hasPermissionsToUseTool(
      write,
      { file_path: 'src/foo.ts', content: 'hello' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('deny')
  })
})

// ---------------------------------------------------------------------------
// Edit tool permission checks
// ---------------------------------------------------------------------------

describe('Edit tool permissions', () => {
  const edit = buildTool(editToolDef(fileStateCache))

  test('safety check: editing .git/ always asks', async () => {
    const ctx = createPermissionContext({ mode: 'bypassPermissions' })
    const result = await hasPermissionsToUseTool(
      edit,
      { file_path: '.git/config', old_string: 'a', new_string: 'b' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('acceptEdits mode auto-allows edits to non-protected paths', async () => {
    const ctx = createPermissionContext({ mode: 'acceptEdits' })
    const result = await hasPermissionsToUseTool(
      edit,
      { file_path: 'src/foo.ts', old_string: 'a', new_string: 'b' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })
})

// ---------------------------------------------------------------------------
// Read-only tools in default mode
// ---------------------------------------------------------------------------

describe('Read-only tools', () => {
  test('Read auto-allows in default mode with allow rule', async () => {
    const read = buildTool(readToolDef(fileStateCache))
    const ctx = createPermissionContext({
      alwaysAllowRules: { userSettings: ['Read'] },
    })
    const result = await hasPermissionsToUseTool(
      read,
      { file_path: 'src/foo.ts' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })

  test('Glob auto-allows in plan mode', async () => {
    const glob = buildTool(globToolDef())
    const ctx = createPermissionContext({ mode: 'plan' })
    const result = await hasPermissionsToUseTool(
      glob,
      { pattern: '**/*.ts' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })

  test('Grep auto-allows in plan mode', async () => {
    const grep = buildTool(grepToolDef())
    const ctx = createPermissionContext({ mode: 'plan' })
    const result = await hasPermissionsToUseTool(
      grep,
      { pattern: 'TODO' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })
})
