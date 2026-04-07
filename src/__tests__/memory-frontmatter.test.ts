import { describe, test, expect } from 'bun:test'
import {
  parseFrontmatter,
  extractGlobs,
  splitRespectingBraces,
  expandBraces,
} from '../services/memory/frontmatter.js'

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  test('returns empty frontmatter for plain markdown', () => {
    const input = '# Hello\n\nNo frontmatter here.'
    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe(input)
  })

  test('parses simple key/value frontmatter', () => {
    const input = '---\npaths: src/*.ts\n---\n# Body'
    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({ paths: 'src/*.ts' })
    expect(result.content).toBe('# Body')
  })

  test('parses YAML list frontmatter', () => {
    const input = '---\npaths:\n  - src/*.ts\n  - test/*.ts\n---\n\nbody'
    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({ paths: ['src/*.ts', 'test/*.ts'] })
    expect(result.content).toBe('\nbody')
  })

  test('strips frontmatter even when YAML is malformed', () => {
    const input = '---\npaths: [unclosed\n---\nbody'
    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe('body')
  })

  test('handles CRLF line endings in frontmatter', () => {
    const input = '---\r\npaths: src/*.ts\r\n---\r\nbody'
    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({ paths: 'src/*.ts' })
    expect(result.content).toBe('body')
  })

  test('does not match frontmatter that does not start at beginning', () => {
    const input = '# Heading\n---\npaths: src/*.ts\n---\nbody'
    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe(input)
  })
})

// ---------------------------------------------------------------------------
// splitRespectingBraces
// ---------------------------------------------------------------------------

describe('splitRespectingBraces', () => {
  test('splits on commas at depth 0', () => {
    expect(splitRespectingBraces('a, b, c')).toEqual(['a', ' b', ' c'])
  })

  test('respects single-level braces', () => {
    expect(splitRespectingBraces('src/*.{ts,tsx}, test/*.ts')).toEqual([
      'src/*.{ts,tsx}',
      ' test/*.ts',
    ])
  })

  test('respects nested braces', () => {
    expect(splitRespectingBraces('a/{b,c/{d,e}},f')).toEqual(['a/{b,c/{d,e}}', 'f'])
  })

  test('returns single element when no commas', () => {
    expect(splitRespectingBraces('one')).toEqual(['one'])
  })
})

// ---------------------------------------------------------------------------
// expandBraces
// ---------------------------------------------------------------------------

describe('expandBraces', () => {
  test('returns input unchanged when no braces', () => {
    expect(expandBraces('src/foo.ts')).toEqual(['src/foo.ts'])
  })

  test('expands a single brace group', () => {
    expect(expandBraces('src/*.{ts,tsx}')).toEqual(['src/*.ts', 'src/*.tsx'])
  })

  test('expands multiple brace groups (cross product)', () => {
    expect(expandBraces('{a,b}/{c,d}')).toEqual(['a/c', 'a/d', 'b/c', 'b/d'])
  })

  test('expands nested braces outside-in', () => {
    expect(expandBraces('a{b,c{d,e}}')).toEqual(['ab', 'acd', 'ace'])
  })

  test('passes unbalanced braces through unchanged', () => {
    expect(expandBraces('src/{ts,tsx')).toEqual(['src/{ts,tsx'])
  })
})

// ---------------------------------------------------------------------------
// extractGlobs
// ---------------------------------------------------------------------------

describe('extractGlobs', () => {
  test('returns undefined when no paths field', () => {
    expect(extractGlobs({})).toBeUndefined()
  })

  test('parses comma-separated string', () => {
    expect(extractGlobs({ paths: 'src/*.ts, test/*.ts' })).toEqual([
      'src/*.ts',
      'test/*.ts',
    ])
  })

  test('parses YAML list', () => {
    expect(extractGlobs({ paths: ['src/*.ts', 'test/*.ts'] })).toEqual([
      'src/*.ts',
      'test/*.ts',
    ])
  })

  test('expands brace alternatives in patterns', () => {
    expect(extractGlobs({ paths: 'src/*.{ts,tsx}' })).toEqual([
      'src/*.ts',
      'src/*.tsx',
    ])
  })

  test('returns empty array for unknown shape', () => {
    expect(extractGlobs({ paths: 42 })).toEqual([])
  })

  test('skips empty strings in YAML lists', () => {
    expect(extractGlobs({ paths: ['src/*.ts', '', '   '] })).toEqual(['src/*.ts'])
  })
})
