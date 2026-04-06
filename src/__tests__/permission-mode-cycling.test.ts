import { describe, test, expect } from 'bun:test'
import { createPermissionContext } from '../services/permissions/context.js'
import {
  getNextPermissionMode,
  cyclePermissionMode,
  permissionModeConfig,
} from '../services/permissions/mode-cycling.js'
import type { PermissionMode } from '../services/permissions/types.js'

describe('permissionModeConfig', () => {
  test('has config for every permission mode', () => {
    const modes: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
    for (const mode of modes) {
      const config = permissionModeConfig[mode]
      expect(config).toBeDefined()
      expect(config.title).toBeString()
      expect(config.shortTitle).toBeString()
      expect(config.symbol).toBeString()
      expect(config.color).toBeString()
    }
  })
})

describe('getNextPermissionMode', () => {
  test('default -> acceptEdits', () => {
    const ctx = createPermissionContext({ mode: 'default' })
    expect(getNextPermissionMode(ctx)).toBe('acceptEdits')
  })

  test('acceptEdits -> plan', () => {
    const ctx = createPermissionContext({ mode: 'acceptEdits' })
    expect(getNextPermissionMode(ctx)).toBe('plan')
  })

  test('plan -> bypassPermissions when available', () => {
    const ctx = createPermissionContext({
      mode: 'plan',
      isBypassPermissionsModeAvailable: true,
    })
    expect(getNextPermissionMode(ctx)).toBe('bypassPermissions')
  })

  test('plan -> default when bypassPermissions unavailable', () => {
    const ctx = createPermissionContext({
      mode: 'plan',
      isBypassPermissionsModeAvailable: false,
    })
    expect(getNextPermissionMode(ctx)).toBe('default')
  })

  test('bypassPermissions -> default', () => {
    const ctx = createPermissionContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
    })
    expect(getNextPermissionMode(ctx)).toBe('default')
  })

  test('full cycle with bypassPermissions available', () => {
    let ctx = createPermissionContext({ isBypassPermissionsModeAvailable: true })
    const visited: PermissionMode[] = [ctx.mode]

    for (let i = 0; i < 4; i++) {
      const next = getNextPermissionMode(ctx)
      visited.push(next)
      ctx = createPermissionContext({ ...ctx, mode: next })
    }

    expect(visited).toEqual([
      'default',
      'acceptEdits',
      'plan',
      'bypassPermissions',
      'default',
    ])
  })

  test('full cycle without bypassPermissions', () => {
    let ctx = createPermissionContext({ isBypassPermissionsModeAvailable: false })
    const visited: PermissionMode[] = [ctx.mode]

    for (let i = 0; i < 3; i++) {
      const next = getNextPermissionMode(ctx)
      visited.push(next)
      ctx = createPermissionContext({ ...ctx, mode: next })
    }

    expect(visited).toEqual([
      'default',
      'acceptEdits',
      'plan',
      'default',
    ])
  })
})

describe('cyclePermissionMode', () => {
  test('returns new context with next mode', () => {
    const ctx = createPermissionContext({ mode: 'default' })
    const result = cyclePermissionMode(ctx)
    expect(result.mode).toBe('acceptEdits')
  })

  test('preserves other context fields', () => {
    const ctx = createPermissionContext({
      mode: 'default',
      alwaysAllowRules: { session: ['Read'] },
      isBypassPermissionsModeAvailable: true,
    })
    const result = cyclePermissionMode(ctx)
    expect(result.mode).toBe('acceptEdits')
    expect(result.alwaysAllowRules).toEqual({ session: ['Read'] })
    expect(result.isBypassPermissionsModeAvailable).toBe(true)
  })

  test('cycles through all modes', () => {
    let ctx = createPermissionContext({ isBypassPermissionsModeAvailable: true })

    ctx = cyclePermissionMode(ctx)
    expect(ctx.mode).toBe('acceptEdits')

    ctx = cyclePermissionMode(ctx)
    expect(ctx.mode).toBe('plan')

    ctx = cyclePermissionMode(ctx)
    expect(ctx.mode).toBe('bypassPermissions')

    ctx = cyclePermissionMode(ctx)
    expect(ctx.mode).toBe('default')
  })
})
