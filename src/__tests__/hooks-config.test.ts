import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { filterByMatcher, getHooksForEvent, clearHooksConfigCache } from '../services/hooks/config.js'
import type { HookMatcher } from '../services/hooks/types.js'

// ---------------------------------------------------------------------------
// filterByMatcher — pure function, no I/O
// ---------------------------------------------------------------------------

describe('filterByMatcher', () => {
  const matchers: HookMatcher[] = [
    {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo bash' }],
    },
    {
      matcher: 'Write',
      hooks: [{ type: 'command', command: 'echo write' }],
    },
    {
      // Wildcard — no matcher
      hooks: [{ type: 'command', command: 'echo all' }],
    },
  ]

  test('returns all matchers when no query is provided', () => {
    const result = filterByMatcher(matchers)
    expect(result).toHaveLength(3)
  })

  test('returns matching matchers and wildcards', () => {
    const result = filterByMatcher(matchers, 'Bash')
    expect(result).toHaveLength(2)
    expect(result[0]!.matcher).toBe('Bash')
    expect(result[1]!.matcher).toBeUndefined()
  })

  test('returns only wildcards when no matcher matches', () => {
    const result = filterByMatcher(matchers, 'Read')
    expect(result).toHaveLength(1)
    expect(result[0]!.matcher).toBeUndefined()
  })

  test('returns empty array when no matchers exist', () => {
    const result = filterByMatcher([], 'Bash')
    expect(result).toHaveLength(0)
  })

  test('exact match only — no partial matching', () => {
    const result = filterByMatcher(matchers, 'Bas')
    expect(result).toHaveLength(1) // Only wildcard
  })
})

// ---------------------------------------------------------------------------
// getHooksForEvent — requires file I/O, tested with temp directories
//
// PA_CONFIG_DIR overrides the user config home (used by getConfigHomeDir).
// process.cwd() controls the project settings path.
// ---------------------------------------------------------------------------

describe('getHooksForEvent (file-based)', () => {
  let tmpDir: string
  let originalCwd: string
  let originalConfigDir: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hooks-config-test-'))
    originalCwd = process.cwd()
    originalConfigDir = process.env['PA_CONFIG_DIR']

    // Create fake config home and project directories
    mkdirSync(join(tmpDir, 'config'), { recursive: true })
    mkdirSync(join(tmpDir, 'project', '.pa'), { recursive: true })

    process.env['PA_CONFIG_DIR'] = join(tmpDir, 'config')
    process.chdir(join(tmpDir, 'project'))
    clearHooksConfigCache()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalConfigDir === undefined) {
      delete process.env['PA_CONFIG_DIR']
    } else {
      process.env['PA_CONFIG_DIR'] = originalConfigDir
    }
    clearHooksConfigCache()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('loads hooks from user settings', () => {
    writeFileSync(
      join(tmpDir, 'config', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'echo user-hook' }],
            },
          ],
        },
      }),
    )

    const result = getHooksForEvent('PreToolUse')
    expect(result).toHaveLength(1)
    expect(result[0]!.matcher).toBe('Bash')
  })

  test('loads hooks from project settings', () => {
    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              hooks: [{ type: 'command', command: 'echo project-hook' }],
            },
          ],
        },
      }),
    )

    const result = getHooksForEvent('PostToolUse')
    expect(result).toHaveLength(1)
  })

  test('merges user and project hooks by concatenation', () => {
    writeFileSync(
      join(tmpDir, 'config', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'echo user' }] },
          ],
        },
      }),
    )
    writeFileSync(
      join(tmpDir, 'project', '.pa', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'echo project' }] },
          ],
        },
      }),
    )

    const result = getHooksForEvent('PreToolUse')
    expect(result).toHaveLength(2)
  })

  test('returns empty array when no settings files exist', () => {
    const result = getHooksForEvent('SessionStart')
    expect(result).toHaveLength(0)
  })

  test('returns empty array for events not in settings', () => {
    writeFileSync(
      join(tmpDir, 'config', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'echo test' }] },
          ],
        },
      }),
    )

    const result = getHooksForEvent('SessionStart')
    expect(result).toHaveLength(0)
  })

  test('handles invalid JSON in settings file gracefully', () => {
    writeFileSync(
      join(tmpDir, 'config', 'settings.json'),
      'not valid json {{{',
    )

    const result = getHooksForEvent('PreToolUse')
    expect(result).toHaveLength(0)
  })

  test('handles invalid hook schema gracefully', () => {
    writeFileSync(
      join(tmpDir, 'config', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [] }], // empty hooks array is invalid
        },
      }),
    )

    const result = getHooksForEvent('PreToolUse')
    expect(result).toHaveLength(0)
  })

  test('settings without hooks field returns empty', () => {
    writeFileSync(
      join(tmpDir, 'config', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Read'] } }),
    )

    const result = getHooksForEvent('PreToolUse')
    expect(result).toHaveLength(0)
  })
})
