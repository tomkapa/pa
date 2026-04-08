import { describe, test, expect } from 'bun:test'
import { extractAtMentions, atMentionAtCursor } from '../services/mentions/tokenizer.js'

// ---------------------------------------------------------------------------
// extractAtMentions
// ---------------------------------------------------------------------------

describe('extractAtMentions', () => {
  test('returns empty array for empty string', () => {
    expect(extractAtMentions('')).toEqual([])
  })

  test('returns empty array when no mentions', () => {
    expect(extractAtMentions('no mentions here')).toEqual([])
  })

  test('extracts single mention at start', () => {
    expect(extractAtMentions('@foo.ts')).toEqual(['foo.ts'])
  })

  test('extracts single mention in the middle', () => {
    expect(extractAtMentions('look at @src/foo.ts please')).toEqual(['src/foo.ts'])
  })

  test('extracts multiple mentions', () => {
    expect(extractAtMentions('diff @a.ts and @b.ts for me'))
      .toEqual(['a.ts', 'b.ts'])
  })

  test('does NOT match email addresses', () => {
    expect(extractAtMentions('alice@example.com wrote this')).toEqual([])
  })

  test('does NOT match email addresses alongside real mentions', () => {
    expect(extractAtMentions('alice@example.com sent @notes.md'))
      .toEqual(['notes.md'])
  })

  test('handles paths with dots and hyphens', () => {
    expect(extractAtMentions('check @src/foo-bar.test.ts'))
      .toEqual(['src/foo-bar.test.ts'])
  })

  test('handles unicode paths', () => {
    expect(extractAtMentions('read @docs/café.md')).toEqual(['docs/café.md'])
  })

  test('mention after newline is valid', () => {
    expect(extractAtMentions('line1\n@foo.ts')).toEqual(['foo.ts'])
  })

  test('mention after tab is valid', () => {
    expect(extractAtMentions('line1\t@foo.ts')).toEqual(['foo.ts'])
  })
})

// ---------------------------------------------------------------------------
// atMentionAtCursor
// ---------------------------------------------------------------------------

describe('atMentionAtCursor', () => {
  test('returns null for empty text', () => {
    expect(atMentionAtCursor('', 0)).toBeNull()
  })

  test('returns null when no @ before cursor', () => {
    expect(atMentionAtCursor('hello', 5)).toBeNull()
  })

  test('returns empty string immediately after bare @', () => {
    expect(atMentionAtCursor('@', 1)).toBe('')
  })

  test('returns partial token while typing', () => {
    expect(atMentionAtCursor('@fo', 3)).toBe('fo')
  })

  test('returns full token at end of mention', () => {
    expect(atMentionAtCursor('@foo', 4)).toBe('foo')
  })

  test('handles @-mention in the middle of text', () => {
    const text = 'look at @bar'
    expect(atMentionAtCursor(text, text.length)).toBe('bar')
  })

  test('returns null when cursor is after a completed mention + space', () => {
    const text = 'look at @bar '
    expect(atMentionAtCursor(text, text.length)).toBeNull()
  })

  test('returns null for email-style @ (no whitespace before)', () => {
    const text = 'alice@example.com'
    expect(atMentionAtCursor(text, text.length)).toBeNull()
  })

  test('cursor inside @-token returns prefix up to cursor', () => {
    const text = '@foobar'
    expect(atMentionAtCursor(text, 4)).toBe('foo')
  })

  test('cursor right after space before @ is not mention mode', () => {
    const text = 'hello '
    expect(atMentionAtCursor(text, text.length)).toBeNull()
  })

  test('cursor on second mention only sees the second one', () => {
    const text = '@a.ts @b.ts'
    expect(atMentionAtCursor(text, text.length)).toBe('b.ts')
  })

  test('cursor after first mention + space returns null', () => {
    const text = '@a.ts '
    expect(atMentionAtCursor(text, text.length)).toBeNull()
  })
})
