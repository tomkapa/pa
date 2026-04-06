import { describe, test, expect } from 'bun:test'
import {
  createPermissionContext,
  applyPermissionUpdate,
  applyPermissionUpdates,
  matchesRule,
} from '../services/permissions/context.js'
import type {
  ToolPermissionContext,
  PermissionUpdate,
} from '../services/permissions/types.js'

describe('createPermissionContext', () => {
  test('creates context with default values', () => {
    const ctx = createPermissionContext()
    expect(ctx.mode).toBe('default')
    expect(ctx.alwaysAllowRules).toEqual({})
    expect(ctx.alwaysDenyRules).toEqual({})
    expect(ctx.alwaysAskRules).toEqual({})
    expect(ctx.additionalWorkingDirectories.size).toBe(0)
    expect(ctx.isBypassPermissionsModeAvailable).toBe(false)
  })

  test('creates context with overrides', () => {
    const ctx = createPermissionContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
    })
    expect(ctx.mode).toBe('bypassPermissions')
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })
})

describe('applyPermissionUpdate — setMode', () => {
  test('sets the mode', () => {
    const ctx = createPermissionContext()
    const updated = applyPermissionUpdate(ctx, {
      type: 'setMode',
      mode: 'plan',
    })
    expect(updated.mode).toBe('plan')
    // Original is unchanged (immutable)
    expect(ctx.mode).toBe('default')
  })
})

describe('applyPermissionUpdate — addRules', () => {
  test('adds allow rules to a source', () => {
    const ctx = createPermissionContext()
    const updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      source: 'userSettings',
      allow: ['Read', 'Bash(git status)'],
    })
    expect(updated.alwaysAllowRules.userSettings).toEqual([
      'Read',
      'Bash(git status)',
    ])
  })

  test('adds deny rules to a source', () => {
    const ctx = createPermissionContext()
    const updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      source: 'userSettings',
      deny: ['Bash(rm -rf /)'],
    })
    expect(updated.alwaysDenyRules.userSettings).toEqual(['Bash(rm -rf /)'])
  })

  test('adds ask rules to a source', () => {
    const ctx = createPermissionContext()
    const updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      source: 'session',
      ask: ['Bash(npm publish)'],
    })
    expect(updated.alwaysAskRules.session).toEqual(['Bash(npm publish)'])
  })

  test('appends to existing rules without duplication', () => {
    const ctx = createPermissionContext({
      alwaysAllowRules: { userSettings: ['Read'] },
    })
    const updated = applyPermissionUpdate(ctx, {
      type: 'addRules',
      source: 'userSettings',
      allow: ['Read', 'Write'],
    })
    expect(updated.alwaysAllowRules.userSettings).toEqual(['Read', 'Write'])
  })

  test('does not modify original context', () => {
    const ctx = createPermissionContext({
      alwaysAllowRules: { userSettings: ['Read'] },
    })
    applyPermissionUpdate(ctx, {
      type: 'addRules',
      source: 'userSettings',
      allow: ['Write'],
    })
    expect(ctx.alwaysAllowRules.userSettings).toEqual(['Read'])
  })
})

describe('applyPermissionUpdate — replaceRules', () => {
  test('replaces all rules for a source', () => {
    const ctx = createPermissionContext({
      alwaysAllowRules: { userSettings: ['Read', 'Write'] },
    })
    const updated = applyPermissionUpdate(ctx, {
      type: 'replaceRules',
      source: 'userSettings',
      allow: ['Glob'],
    })
    expect(updated.alwaysAllowRules.userSettings).toEqual(['Glob'])
  })

  test('clears a category when given empty array', () => {
    const ctx = createPermissionContext({
      alwaysDenyRules: { cliArg: ['Bash'] },
    })
    const updated = applyPermissionUpdate(ctx, {
      type: 'replaceRules',
      source: 'cliArg',
      deny: [],
    })
    expect(updated.alwaysDenyRules.cliArg).toEqual([])
  })
})

describe('applyPermissionUpdate — removeRules', () => {
  test('removes specific rules from a source', () => {
    const ctx = createPermissionContext({
      alwaysAllowRules: { session: ['Read', 'Write', 'Bash(git status)'] },
    })
    const updated = applyPermissionUpdate(ctx, {
      type: 'removeRules',
      source: 'session',
      allow: ['Write'],
    })
    expect(updated.alwaysAllowRules.session).toEqual([
      'Read',
      'Bash(git status)',
    ])
  })

  test('is a no-op if rule not found', () => {
    const ctx = createPermissionContext({
      alwaysAllowRules: { session: ['Read'] },
    })
    const updated = applyPermissionUpdate(ctx, {
      type: 'removeRules',
      source: 'session',
      allow: ['NotThere'],
    })
    expect(updated.alwaysAllowRules.session).toEqual(['Read'])
  })
})

describe('applyPermissionUpdate — addDirectories', () => {
  test('adds additional working directories', () => {
    const ctx = createPermissionContext()
    const dirs = new Map([
      ['/tmp/extra', { path: '/tmp/extra', readOnly: false }],
    ])
    const updated = applyPermissionUpdate(ctx, {
      type: 'addDirectories',
      directories: dirs,
    })
    expect(updated.additionalWorkingDirectories.get('/tmp/extra')).toEqual({
      path: '/tmp/extra',
      readOnly: false,
    })
  })
})

describe('applyPermissionUpdate — removeDirectories', () => {
  test('removes additional working directories', () => {
    const dirs = new Map([
      ['/tmp/a', { path: '/tmp/a', readOnly: false }],
      ['/tmp/b', { path: '/tmp/b', readOnly: true }],
    ])
    const ctx = createPermissionContext({
      additionalWorkingDirectories: dirs,
    })
    const updated = applyPermissionUpdate(ctx, {
      type: 'removeDirectories',
      paths: ['/tmp/a'],
    })
    expect(updated.additionalWorkingDirectories.has('/tmp/a')).toBe(false)
    expect(updated.additionalWorkingDirectories.has('/tmp/b')).toBe(true)
  })
})

describe('applyPermissionUpdates', () => {
  test('applies multiple updates in sequence', () => {
    const ctx = createPermissionContext()
    const updates: PermissionUpdate[] = [
      { type: 'setMode', mode: 'acceptEdits' },
      { type: 'addRules', source: 'userSettings', allow: ['Read'] },
      { type: 'addRules', source: 'cliArg', deny: ['Bash(rm -rf /)'] },
    ]
    const updated = applyPermissionUpdates(ctx, updates)
    expect(updated.mode).toBe('acceptEdits')
    expect(updated.alwaysAllowRules.userSettings).toEqual(['Read'])
    expect(updated.alwaysDenyRules.cliArg).toEqual(['Bash(rm -rf /)'])
  })
})

describe('matchesRule', () => {
  test('tool-level rule matches any input for that tool', () => {
    expect(matchesRule('Bash', 'Bash', 'git status')).toBe(true)
    expect(matchesRule('Bash', 'Bash', undefined)).toBe(true)
  })

  test('tool-level rule does not match different tool', () => {
    expect(matchesRule('Read', 'Bash', 'git status')).toBe(false)
  })

  test('content-specific rule matches exact content', () => {
    expect(matchesRule('Bash(git status)', 'Bash', 'git status')).toBe(true)
  })

  test('content-specific rule does not match different content', () => {
    expect(matchesRule('Bash(git status)', 'Bash', 'git push')).toBe(false)
  })

  test('content-specific rule does not match without content', () => {
    expect(matchesRule('Bash(git status)', 'Bash', undefined)).toBe(false)
  })

  test('MCP server-level rule matches tools from that server', () => {
    expect(
      matchesRule('mcp__server1', 'mcp__server1__tool1', undefined),
    ).toBe(true)
  })

  test('MCP server-level rule does not match other server', () => {
    expect(
      matchesRule('mcp__server1', 'mcp__server2__tool1', undefined),
    ).toBe(false)
  })

  test('MCP tool-specific rule matches exactly', () => {
    expect(
      matchesRule('mcp__server1__tool1', 'mcp__server1__tool1', undefined),
    ).toBe(true)
  })

  test('MCP tool-specific rule does not match other tool', () => {
    expect(
      matchesRule('mcp__server1__tool1', 'mcp__server1__tool2', undefined),
    ).toBe(false)
  })
})
