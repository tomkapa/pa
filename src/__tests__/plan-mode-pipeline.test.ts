import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { hasPermissionsToUseTool } from '../services/permissions/pipeline.js'
import { createPermissionContext } from '../services/permissions/context.js'
import { buildTool } from '../services/tools/build-tool.js'
import { makeContext } from '../testing/make-context.js'
import { makeToolDef } from '../testing/make-tool-def.js'
import { getPlanFilePath, __clearSlugCacheForTests } from '../services/plans/index.js'
import { getSessionId } from '../services/observability/state.js'
import type { PermissionResult } from '../services/permissions/types.js'

const TEST_DIR = join(import.meta.dir, '../../.test-plan-pipeline-tmp')

beforeEach(() => {
  process.env.PA_CONFIG_DIR = TEST_DIR
  mkdirSync(TEST_DIR, { recursive: true })
  __clearSlugCacheForTests()
})

afterEach(() => {
  delete process.env.PA_CONFIG_DIR
  __clearSlugCacheForTests()
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch { /* ok */ }
})

describe('plan-file carve-out in permission pipeline', () => {
  test('Write to session plan file is allowed in plan mode', async () => {
    const planPath = getPlanFilePath(getSessionId())
    const tool = buildTool(makeToolDef({
      name: 'Write',
      isReadOnly: () => false,
      async checkPermissions(): Promise<PermissionResult> {
        return { behavior: 'passthrough' }
      },
    }))
    const ctx = createPermissionContext({ mode: 'plan' })

    const result = await hasPermissionsToUseTool(
      tool,
      { file_path: planPath, content: '# Plan' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })

  test('Edit to session plan file is allowed in plan mode', async () => {
    const planPath = getPlanFilePath(getSessionId())
    const tool = buildTool(makeToolDef({
      name: 'Edit',
      isReadOnly: () => false,
      async checkPermissions(): Promise<PermissionResult> {
        return { behavior: 'passthrough' }
      },
    }))
    const ctx = createPermissionContext({ mode: 'plan' })

    const result = await hasPermissionsToUseTool(
      tool,
      { file_path: planPath, old_string: 'old', new_string: 'new' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })

  test('Write to non-plan file is denied in plan mode', async () => {
    const tool = buildTool(makeToolDef({
      name: 'Write',
      isReadOnly: () => false,
      async checkPermissions(): Promise<PermissionResult> {
        return { behavior: 'passthrough' }
      },
    }))
    const ctx = createPermissionContext({ mode: 'plan' })

    const result = await hasPermissionsToUseTool(
      tool,
      { file_path: '/tmp/not-a-plan.md', content: 'nope' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('deny')
  })

  test('Write to plan file of another session is denied in plan mode', async () => {
    // Force a different session's plan file by constructing a path directly
    const plansDir = join(TEST_DIR, 'plans')
    mkdirSync(plansDir, { recursive: true })
    const otherPlanPath = join(plansDir, 'other-session.md')

    const tool = buildTool(makeToolDef({
      name: 'Write',
      isReadOnly: () => false,
      async checkPermissions(): Promise<PermissionResult> {
        return { behavior: 'passthrough' }
      },
    }))
    const ctx = createPermissionContext({ mode: 'plan' })

    const result = await hasPermissionsToUseTool(
      tool,
      { file_path: otherPlanPath, content: 'evil' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('deny')
  })

  test('plan file carve-out does not override tool-level deny rules', async () => {
    const planPath = getPlanFilePath(getSessionId())
    const tool = buildTool(makeToolDef({
      name: 'Write',
      isReadOnly: () => false,
      async checkPermissions(): Promise<PermissionResult> {
        return { behavior: 'passthrough' }
      },
    }))
    // Tool-level deny: blocks ALL writes regardless of path
    const ctx = createPermissionContext({
      mode: 'plan',
      alwaysDenyRules: { userSettings: ['Write'] },
    })

    const result = await hasPermissionsToUseTool(
      tool,
      { file_path: planPath, content: '# Plan' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('deny')
  })

  test('ExitPlanMode is askable in plan mode (isBypassImmune)', async () => {
    const tool = buildTool(makeToolDef({
      name: 'ExitPlanMode',
      isReadOnly: () => false,
      async checkPermissions(): Promise<PermissionResult> {
        return {
          behavior: 'ask',
          reason: { type: 'toolSpecific', description: 'exit plan mode' },
          message: 'Exit plan mode?',
          isBypassImmune: true,
        }
      },
    }))
    const ctx = createPermissionContext({ mode: 'plan' })

    const result = await hasPermissionsToUseTool(
      tool,
      {},
      ctx,
      makeContext(),
    )
    // Should be 'ask' (not 'deny') because isBypassImmune short-circuits
    // before the plan mode write-deny at step 6
    expect(result.behavior).toBe('ask')
  })

  test('EnterPlanMode is askable in plan mode (isBypassImmune)', async () => {
    const tool = buildTool(makeToolDef({
      name: 'EnterPlanMode',
      isReadOnly: () => true,
      async checkPermissions(): Promise<PermissionResult> {
        return {
          behavior: 'ask',
          reason: { type: 'toolSpecific', description: 'enter plan mode' },
          message: 'Enter plan mode?',
          isBypassImmune: true,
        }
      },
    }))
    const ctx = createPermissionContext({ mode: 'plan' })

    const result = await hasPermissionsToUseTool(
      tool,
      {},
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('non-read-only tool without isBypassImmune is denied in plan mode', async () => {
    const tool = buildTool(makeToolDef({
      name: 'Bash',
      isReadOnly: () => false,
    }))
    const ctx = createPermissionContext({ mode: 'plan' })

    const result = await hasPermissionsToUseTool(
      tool,
      { command: 'ls' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('deny')
  })

  test('Read tools are allowed in plan mode', async () => {
    const tool = buildTool(makeToolDef({
      name: 'Read',
      isReadOnly: () => true,
    }))
    const ctx = createPermissionContext({ mode: 'plan' })

    const result = await hasPermissionsToUseTool(
      tool,
      { value: '/tmp/file.ts' },
      ctx,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })
})

describe('prePlanMode in permission context', () => {
  test('setMode to plan saves prePlanMode', () => {
    const { applyPermissionUpdate } = require('../services/permissions/context.js')
    const ctx = createPermissionContext({ mode: 'acceptEdits' })
    const updated = applyPermissionUpdate(ctx, { type: 'setMode', mode: 'plan' })
    expect(updated.mode).toBe('plan')
    expect(updated.prePlanMode).toBe('acceptEdits')
  })

  test('setMode from plan clears prePlanMode', () => {
    const { applyPermissionUpdate } = require('../services/permissions/context.js')
    const ctx = createPermissionContext({ mode: 'plan', prePlanMode: 'acceptEdits' })
    const updated = applyPermissionUpdate(ctx, { type: 'setMode', mode: 'default' })
    expect(updated.mode).toBe('default')
    expect(updated.prePlanMode).toBeUndefined()
  })

  test('setMode between non-plan modes preserves prePlanMode', () => {
    const { applyPermissionUpdate } = require('../services/permissions/context.js')
    const ctx = createPermissionContext({ mode: 'default', prePlanMode: 'acceptEdits' })
    const updated = applyPermissionUpdate(ctx, { type: 'setMode', mode: 'acceptEdits' })
    expect(updated.mode).toBe('acceptEdits')
    expect(updated.prePlanMode).toBe('acceptEdits')
  })
})
