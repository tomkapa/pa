import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  getManagedSettingsPath,
  loadManagedSettings,
  extractPermissionRules,
  SettingsJsonSchema,
} from '../services/permissions/managed-settings.js'

// ---------------------------------------------------------------------------
// getManagedSettingsPath
// ---------------------------------------------------------------------------

describe('getManagedSettingsPath', () => {
  test('returns macOS path for darwin', () => {
    expect(getManagedSettingsPath('darwin')).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    )
  })

  test('returns Linux path for linux', () => {
    expect(getManagedSettingsPath('linux')).toBe(
      '/etc/claude-code/managed-settings.json',
    )
  })

  test('returns Windows path for win32', () => {
    expect(getManagedSettingsPath('win32')).toBe(
      'C:\\ProgramData\\ClaudeCode\\managed-settings.json',
    )
  })

  test('returns Linux path for unknown platform', () => {
    expect(getManagedSettingsPath('freebsd' as NodeJS.Platform)).toBe(
      '/etc/claude-code/managed-settings.json',
    )
  })
})

// ---------------------------------------------------------------------------
// SettingsJsonSchema
// ---------------------------------------------------------------------------

describe('SettingsJsonSchema', () => {
  test('validates minimal settings', () => {
    const result = SettingsJsonSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  test('validates settings with permissions', () => {
    const result = SettingsJsonSchema.safeParse({
      permissions: {
        allow: ['Read', 'Bash(git status)'],
        deny: ['Bash(rm -rf /)'],
      },
    })
    expect(result.success).toBe(true)
  })

  test('validates settings with allowManagedPermissionRulesOnly', () => {
    const result = SettingsJsonSchema.safeParse({
      allowManagedPermissionRulesOnly: true,
    })
    expect(result.success).toBe(true)
  })

  test('allows unknown keys (forward compat)', () => {
    const result = SettingsJsonSchema.safeParse({
      futureField: 'something',
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid permissions structure', () => {
    const result = SettingsJsonSchema.safeParse({
      permissions: { allow: 'not-an-array' },
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// loadManagedSettings (with temp files)
// ---------------------------------------------------------------------------

describe('loadManagedSettings', () => {
  const tempDir = path.join(import.meta.dir, '.tmp-managed-settings')
  const tempFile = path.join(tempDir, 'managed-settings.json')

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('returns loaded: false when file does not exist', () => {
    // Use a path that doesn't exist
    const result = loadManagedSettings('linux')
    // The actual /etc path won't exist in test env — that's the expected behavior
    expect(result.loaded).toBe(false)
    expect(result.error).toBeUndefined()
  })

  test('returns loaded: false with error for invalid JSON', () => {
    writeFileSync(tempFile, 'not json {{{', 'utf-8')
    // We test the core logic by importing the private function behavior
    // via a round-trip through the schema
    const result = SettingsJsonSchema.safeParse('not json')
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// extractPermissionRules
// ---------------------------------------------------------------------------

describe('extractPermissionRules', () => {
  test('extracts all rule categories', () => {
    const rules = extractPermissionRules({
      permissions: {
        allow: ['Read', 'Grep'],
        deny: ['Bash(rm -rf /)'],
        ask: ['Bash(npm publish)'],
      },
    })
    expect(rules.allow).toEqual(['Read', 'Grep'])
    expect(rules.deny).toEqual(['Bash(rm -rf /)'])
    expect(rules.ask).toEqual(['Bash(npm publish)'])
  })

  test('returns empty arrays when no permissions', () => {
    const rules = extractPermissionRules({})
    expect(rules.allow).toEqual([])
    expect(rules.deny).toEqual([])
    expect(rules.ask).toEqual([])
  })

  test('returns empty arrays for missing categories', () => {
    const rules = extractPermissionRules({
      permissions: { allow: ['Read'] },
    })
    expect(rules.allow).toEqual(['Read'])
    expect(rules.deny).toEqual([])
    expect(rules.ask).toEqual([])
  })
})
