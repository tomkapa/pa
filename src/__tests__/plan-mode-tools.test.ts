import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildTool } from '../services/tools/build-tool.js'
import { enterPlanModeToolDef } from '../tools/enterPlanModeTool.js'
import { exitPlanModeToolDef } from '../tools/exitPlanModeTool.js'
import { createPermissionContext } from '../services/permissions/context.js'
import { makeContext } from '../testing/make-context.js'
import { getPlanFilePath, __clearSlugCacheForTests } from '../services/plans/index.js'
import { getSessionId } from '../services/observability/state.js'
import type { ToolPermissionContext } from '../services/permissions/types.js'

const TEST_DIR = join(import.meta.dir, '../../.test-plan-mode-tmp')

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

describe('EnterPlanModeTool', () => {
  const tool = buildTool(enterPlanModeToolDef())

  test('has correct name and metadata', () => {
    expect(tool.name).toBe('EnterPlanMode')
    expect(tool.isReadOnly({})).toBe(true)
    expect(tool.isConcurrencySafe({})).toBe(false)
  })

  test('checkPermissions returns ask behavior', async () => {
    const ctx = makeContext()
    const result = await tool.checkPermissions({}, ctx)
    expect(result.behavior).toBe('ask')
  })

  test('call transitions permission context to plan mode', async () => {
    let permCtx: ToolPermissionContext = createPermissionContext({ mode: 'default' })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
      setPermissionContext: (updater) => { permCtx = updater(permCtx) },
    })

    const result = await tool.call({}, ctx)
    expect(result.data.entered).toBe(true)
    expect(result.data.fromMode).toBe('default')
    expect(permCtx.mode).toBe('plan')
    expect(permCtx.prePlanMode).toBe('default')
  })

  test('call saves acceptEdits as prePlanMode', async () => {
    let permCtx: ToolPermissionContext = createPermissionContext({ mode: 'acceptEdits' })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
      setPermissionContext: (updater) => { permCtx = updater(permCtx) },
    })

    await tool.call({}, ctx)
    expect(permCtx.mode).toBe('plan')
    expect(permCtx.prePlanMode).toBe('acceptEdits')
  })

  test('mapToolResultToToolResultBlockParam includes plan file path', () => {
    const planPath = getPlanFilePath(getSessionId())
    const block = tool.mapToolResultToToolResultBlockParam(
      { entered: true, planFilePath: planPath, fromMode: 'default' },
      'test-id',
    )
    expect(block.tool_use_id).toBe('test-id')
    expect(typeof block.content).toBe('string')
    expect(block.content as string).toContain(planPath)
    expect(block.content as string).toContain('Entered plan mode')
  })

  test('prompt describes when to use plan mode', async () => {
    const promptText = await tool.prompt()
    expect(promptText).toContain('complex tasks')
    expect(promptText).toContain('Do NOT use')
  })
})

describe('ExitPlanModeTool', () => {
  const tool = buildTool(exitPlanModeToolDef())

  test('has correct name and metadata', () => {
    expect(tool.name).toBe('ExitPlanMode')
    expect(tool.isReadOnly({})).toBe(false)
    expect(tool.isConcurrencySafe({})).toBe(false)
  })

  test('validateInput rejects when not in plan mode', async () => {
    const permCtx = createPermissionContext({ mode: 'default' })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
    })

    const result = await tool.validateInput!({}, ctx)
    expect(result.result).toBe(false)
    expect('message' in result && result.message).toContain('not in plan mode')
  })

  test('validateInput accepts when in plan mode', async () => {
    const permCtx = createPermissionContext({ mode: 'plan' })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
    })

    const result = await tool.validateInput!({}, ctx)
    expect(result.result).toBe(true)
  })

  test('checkPermissions returns ask behavior', async () => {
    const ctx = makeContext()
    const result = await tool.checkPermissions({}, ctx)
    expect(result.behavior).toBe('ask')
  })

  test('call restores prePlanMode', async () => {
    let permCtx: ToolPermissionContext = createPermissionContext({
      mode: 'plan',
      prePlanMode: 'acceptEdits',
    })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
      setPermissionContext: (updater) => { permCtx = updater(permCtx) },
    })

    await tool.call({}, ctx)
    expect(permCtx.mode).toBe('acceptEdits')
    expect(permCtx.prePlanMode).toBeUndefined()
  })

  test('call defaults to default mode when prePlanMode is undefined', async () => {
    let permCtx: ToolPermissionContext = createPermissionContext({ mode: 'plan' })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
      setPermissionContext: (updater) => { permCtx = updater(permCtx) },
    })

    await tool.call({}, ctx)
    expect(permCtx.mode).toBe('default')
  })

  test('call reads plan from disk', async () => {
    const sessionId = getSessionId()
    const planPath = getPlanFilePath(sessionId)
    writeFileSync(planPath, '# Test Plan\n\n1. Step one')

    let permCtx: ToolPermissionContext = createPermissionContext({ mode: 'plan' })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
      setPermissionContext: (updater) => { permCtx = updater(permCtx) },
    })

    const result = await tool.call({}, ctx)
    expect(result.data.plan).toBe('# Test Plan\n\n1. Step one')
    expect(result.data.filePath).toBe(planPath)
  })

  test('call returns null plan when file does not exist', async () => {
    let permCtx: ToolPermissionContext = createPermissionContext({ mode: 'plan' })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
      setPermissionContext: (updater) => { permCtx = updater(permCtx) },
    })

    const result = await tool.call({}, ctx)
    expect(result.data.plan).toBeNull()
  })

  test('call is a no-op if already out of plan mode', async () => {
    let permCtx: ToolPermissionContext = createPermissionContext({ mode: 'default' })
    const ctx = makeContext({
      getPermissionContext: () => permCtx,
      setPermissionContext: (updater) => { permCtx = updater(permCtx) },
    })

    await tool.call({}, ctx)
    expect(permCtx.mode).toBe('default')
  })

  test('mapToolResultToToolResultBlockParam with plan content', () => {
    const block = tool.mapToolResultToToolResultBlockParam(
      { plan: '# My Plan\n\nDo things', filePath: '/tmp/plan.md' },
      'test-id',
    )
    expect(block.tool_use_id).toBe('test-id')
    expect(block.content as string).toContain('approved your plan')
    expect(block.content as string).toContain('# My Plan')
  })

  test('mapToolResultToToolResultBlockParam with empty plan', () => {
    const block = tool.mapToolResultToToolResultBlockParam(
      { plan: null, filePath: '/tmp/plan.md' },
      'test-id',
    )
    expect(block.content as string).toContain('approved exiting plan mode')
  })
})
