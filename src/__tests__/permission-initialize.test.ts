import { describe, test, expect } from 'bun:test'
import { initializeToolPermissionContext } from '../services/permissions/initialize.js'

describe('initializeToolPermissionContext', () => {
  test('returns context with default values when no options', () => {
    const { context } = initializeToolPermissionContext()
    expect(context.mode).toBe('default')
    expect(context.alwaysAllowRules).toEqual({})
    expect(context.alwaysDenyRules).toEqual({})
    expect(context.alwaysAskRules).toEqual({})
  })

  test('sets mode from options', () => {
    const { context } = initializeToolPermissionContext({ mode: 'plan' })
    expect(context.mode).toBe('plan')
  })

  test('loads CLI allowed tools', () => {
    const { context } = initializeToolPermissionContext({
      allowedTools: ['Read', 'Grep'],
    })
    expect(context.alwaysAllowRules.cliArg).toEqual(['Read', 'Grep'])
  })

  test('loads CLI disallowed tools', () => {
    const { context } = initializeToolPermissionContext({
      disallowedTools: ['Bash(rm -rf /)'],
    })
    expect(context.alwaysDenyRules.cliArg).toEqual(['Bash(rm -rf /)'])
  })

  test('loads user settings', () => {
    const { context } = initializeToolPermissionContext({
      userSettings: {
        permissions: {
          allow: ['Read'],
          deny: ['Bash(rm -rf /)'],
        },
      },
    })
    expect(context.alwaysAllowRules.userSettings).toEqual(['Read'])
    expect(context.alwaysDenyRules.userSettings).toEqual(['Bash(rm -rf /)'])
  })

  test('loads project settings', () => {
    const { context } = initializeToolPermissionContext({
      projectSettings: {
        permissions: {
          allow: ['Glob'],
        },
      },
    })
    expect(context.alwaysAllowRules.projectSettings).toEqual(['Glob'])
  })

  test('loads local settings', () => {
    const { context } = initializeToolPermissionContext({
      localSettings: {
        permissions: {
          ask: ['Bash(npm publish)'],
        },
      },
    })
    expect(context.alwaysAskRules.localSettings).toEqual(['Bash(npm publish)'])
  })

  test('reports managed settings path and load status', () => {
    const result = initializeToolPermissionContext()
    expect(result.managedSettingsPath).toBeTruthy()
    // In a test environment, managed settings file likely doesn't exist
    expect(typeof result.managedSettingsLoaded).toBe('boolean')
  })

  test('filters invalid rules and reports validation warnings', () => {
    const result = initializeToolPermissionContext({
      userSettings: {
        permissions: {
          allow: ['Read', 'bash(invalid)', 'Glob'],
        },
      },
    })
    // "bash(invalid)" should be filtered out (lowercase tool name)
    expect(result.context.alwaysAllowRules.userSettings).toEqual(['Read', 'Glob'])
    expect(result.validationWarnings).toHaveLength(1)
    expect(result.validationWarnings[0]!.rule).toBe('bash(invalid)')
    expect(result.validationWarnings[0]!.source).toBe('userSettings')
  })

  test('returns empty validationWarnings when all rules are valid', () => {
    const result = initializeToolPermissionContext({
      allowedTools: ['Read', 'Bash(git status)'],
    })
    expect(result.validationWarnings).toHaveLength(0)
  })
})
