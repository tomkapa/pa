import { describe, test, expect } from 'bun:test'
import { slashCommandAtCursor } from '../commands/tokenizer.js'

describe('slashCommandAtCursor', () => {
  test('returns null for empty text', () => {
    expect(slashCommandAtCursor('', 0)).toBeNull()
  })

  test('returns null when text does not start with /', () => {
    expect(slashCommandAtCursor('hello', 5)).toBeNull()
  })

  test('returns empty string immediately after bare /', () => {
    expect(slashCommandAtCursor('/', 1)).toBe('')
  })

  test('returns partial token while typing', () => {
    expect(slashCommandAtCursor('/co', 3)).toBe('co')
  })

  test('returns full token at end', () => {
    expect(slashCommandAtCursor('/compact', 8)).toBe('compact')
  })

  test('returns null when / is not at start', () => {
    expect(slashCommandAtCursor('hello /compact', 14)).toBeNull()
  })

  test('returns null when cursor is past a space (arguments started)', () => {
    expect(slashCommandAtCursor('/compact focus on tests', 22)).toBeNull()
  })

  test('returns null when cursor is at the space', () => {
    expect(slashCommandAtCursor('/compact ', 9)).toBeNull()
  })

  test('cursor in the middle of token returns prefix up to cursor', () => {
    expect(slashCommandAtCursor('/compact', 4)).toBe('com')
  })

  test('returns null for text starting with whitespace then /', () => {
    expect(slashCommandAtCursor(' /compact', 9)).toBeNull()
  })

  test('returns null when cursor is at position 0 (before the /)', () => {
    expect(slashCommandAtCursor('/compact', 0)).toBeNull()
  })
})
