import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getPlanModeSection } from '../services/system-prompt/dynamic-sections.js'
import { createPermissionContext } from '../services/permissions/context.js'
import { __clearSlugCacheForTests } from '../services/plans/index.js'

const TEST_DIR = join(import.meta.dir, '../../.test-plan-prompt-tmp')

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

describe('getPlanModeSection', () => {
  test('returns null when not in plan mode', () => {
    const ctx = createPermissionContext({ mode: 'default' })
    expect(getPlanModeSection(ctx)).toBeNull()
  })

  test('returns null when permissionContext is undefined', () => {
    expect(getPlanModeSection(undefined)).toBeNull()
  })

  test('returns null in acceptEdits mode', () => {
    const ctx = createPermissionContext({ mode: 'acceptEdits' })
    expect(getPlanModeSection(ctx)).toBeNull()
  })

  test('returns plan mode instructions when in plan mode', () => {
    const ctx = createPermissionContext({ mode: 'plan' })
    const section = getPlanModeSection(ctx)
    expect(section).not.toBeNull()
    expect(section).toContain('PLAN MODE')
    expect(section).toContain('plan file path')
    expect(section).toContain('ExitPlanMode')
  })

  test('includes the resolved plan file path', () => {
    const ctx = createPermissionContext({ mode: 'plan' })
    const section = getPlanModeSection(ctx)!
    // Should contain a path ending in .md inside the plans directory
    expect(section).toContain(join(TEST_DIR, 'plans'))
    expect(section).toMatch(/\.md/)
  })
})
