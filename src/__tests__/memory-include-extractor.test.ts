import { describe, test, expect } from 'bun:test'
import {
  extractIncludes,
  normalizeIncludePath,
} from '../services/memory/include-extractor.js'

// ---------------------------------------------------------------------------
// extractIncludes
// ---------------------------------------------------------------------------

describe('extractIncludes', () => {
  test('finds an include at the start of a line', () => {
    expect(extractIncludes('@./other.md')).toEqual(['./other.md'])
  })

  test('finds an include after whitespace', () => {
    expect(extractIncludes('see @./other.md for details')).toEqual(['./other.md'])
  })

  test('does NOT match @ that follows a non-space character (email-like)', () => {
    expect(extractIncludes('email me at user@host.com')).toEqual([])
  })

  test('finds multiple includes', () => {
    const md = 'first @./a.md and second @~/b.md and third @/abs/c.md'
    expect(extractIncludes(md)).toEqual(['./a.md', '~/b.md', '/abs/c.md'])
  })

  test('skips includes inside fenced code blocks', () => {
    const md = [
      'before @./real.md',
      '```',
      'example: @./should-be-ignored.md',
      '```',
      'after @./second-real.md',
    ].join('\n')
    expect(extractIncludes(md)).toEqual(['./real.md', './second-real.md'])
  })

  test('skips includes inside inline code', () => {
    const md = 'this is `@./not-included.md` not loaded'
    expect(extractIncludes(md)).toEqual([])
  })

  test('handles backslash-escaped spaces', () => {
    expect(extractIncludes('@path\\ with\\ spaces.md')).toEqual([
      'path with spaces.md',
    ])
  })

  test('strips fragment identifiers', () => {
    expect(extractIncludes('@docs/spec.md#section')).toEqual(['docs/spec.md'])
  })

  test('returns empty array for empty markdown', () => {
    expect(extractIncludes('')).toEqual([])
  })

  test('extracts includes from list items', () => {
    const md = '- see @./first.md\n- and @./second.md'
    expect(extractIncludes(md)).toEqual(['./first.md', './second.md'])
  })
})

// ---------------------------------------------------------------------------
// normalizeIncludePath
// ---------------------------------------------------------------------------

describe('normalizeIncludePath', () => {
  test('passes plain paths through unchanged', () => {
    expect(normalizeIncludePath('docs/spec.md')).toBe('docs/spec.md')
  })

  test('resolves backslash-escaped spaces', () => {
    expect(normalizeIncludePath('a\\ b\\ c.md')).toBe('a b c.md')
  })

  test('strips fragment identifier', () => {
    expect(normalizeIncludePath('file.md#anchor')).toBe('file.md')
  })

  test('handles both escapes and fragments', () => {
    expect(normalizeIncludePath('a\\ b.md#x')).toBe('a b.md')
  })
})
