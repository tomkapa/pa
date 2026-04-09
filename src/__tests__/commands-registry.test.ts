import { describe, test, expect, mock } from 'bun:test'
import { SLASH_COMMANDS, filterCommands, findCommand } from '../commands/registry.js'
import type { SlashCommandContext } from '../commands/registry.js'

describe('SLASH_COMMANDS', () => {
  test('is sorted alphabetically by name', () => {
    const names = SLASH_COMMANDS.map(c => c.name)
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })

  test('every command has a non-empty name', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.name.length).toBeGreaterThan(0)
    }
  })

  test('every command has a non-empty description', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.description.length).toBeGreaterThan(0)
    }
  })

  test('every command has an execute handler', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(typeof cmd.execute).toBe('function')
    }
  })

  test('no duplicate command names', () => {
    const names = SLASH_COMMANDS.map(c => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('findCommand', () => {
  test('returns command for known name', () => {
    const cmd = findCommand('compact')
    expect(cmd).toBeDefined()
    expect(cmd!.name).toBe('compact')
  })

  test('returns undefined for unknown name', () => {
    expect(findCommand('nonexistent')).toBeUndefined()
  })

  test('is case-sensitive', () => {
    expect(findCommand('Compact')).toBeUndefined()
  })
})

describe('filterCommands', () => {
  test('returns all commands for empty prefix', () => {
    const result = filterCommands(SLASH_COMMANDS, '')
    expect(result.length).toBe(SLASH_COMMANDS.length)
  })

  test('filters by prefix', () => {
    const result = filterCommands(SLASH_COMMANDS, 'co')
    expect(result.every(c => c.name.startsWith('co'))).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  test('is case-insensitive', () => {
    const lower = filterCommands(SLASH_COMMANDS, 'co')
    const upper = filterCommands(SLASH_COMMANDS, 'CO')
    expect(lower).toEqual(upper)
  })

  test('returns empty for non-matching prefix', () => {
    const result = filterCommands(SLASH_COMMANDS, 'zzz')
    expect(result).toEqual([])
  })

  test('does not mutate original array', () => {
    const original = [...SLASH_COMMANDS]
    filterCommands(SLASH_COMMANDS, '')
    expect(SLASH_COMMANDS).toEqual(original)
  })
})

// ---------------------------------------------------------------------------
// Command handler tests
// ---------------------------------------------------------------------------

function createMockContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    args: '',
    abortSignal: new AbortController().signal,
    messages: () => [],
    addSystemMessage: mock(() => {}),
    persistMessage: mock(() => {}),
    setMessages: mock(() => {}),
    ...overrides,
  }
}

describe('/clear handler', () => {
  test('clears messages via setMessages', async () => {
    const cmd = findCommand('clear')!
    const ctx = createMockContext()
    await cmd.execute(ctx)

    expect(ctx.setMessages).toHaveBeenCalled()
    // The updater should return an empty array
    const updater = (ctx.setMessages as ReturnType<typeof mock>).mock.calls[0]![0] as (prev: unknown[]) => unknown[]
    expect(updater([{ uuid: '1' }, { uuid: '2' }])).toEqual([])
  })

  test('shows a confirmation system message', async () => {
    const cmd = findCommand('clear')!
    const ctx = createMockContext()
    await cmd.execute(ctx)

    expect(ctx.addSystemMessage).toHaveBeenCalledWith(
      'conversation_cleared',
      'Conversation cleared.',
      'info',
    )
  })
})

describe('/compact handler', () => {
  test('throws when no summarizer is configured', async () => {
    const cmd = findCommand('compact')!
    const ctx = createMockContext({ summarize: undefined })
    await expect(cmd.execute(ctx)).rejects.toThrow('/compact: no summarizer configured')
  })

  test('skips when no messages after compact boundary', async () => {
    const cmd = findCommand('compact')!
    const ctx = createMockContext({
      messages: () => [],
      summarize: mock(() => Promise.resolve('summary')),
    })
    await cmd.execute(ctx)

    expect(ctx.addSystemMessage).toHaveBeenCalledWith(
      'compact_skipped',
      'Nothing to compact yet.',
      'info',
    )
  })
})
