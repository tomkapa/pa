import { describe, expect, test } from 'bun:test'
import {
  formatDefinitionResult,
  formatReferencesResult,
  formatHoverResult,
} from '../lsp/formatters.js'
import type { Location, LocationLink, Hover } from 'vscode-languageserver-protocol'

const CWD = '/project'

// ---------------------------------------------------------------------------
// goToDefinition
// ---------------------------------------------------------------------------

describe('formatDefinitionResult', () => {
  test('null result returns helpful message', () => {
    const result = formatDefinitionResult(null, CWD)
    expect(result).toContain('No definition found')
  })

  test('empty array returns helpful message', () => {
    const result = formatDefinitionResult([], CWD)
    expect(result).toContain('No definition found')
  })

  test('single Location result', () => {
    const loc: Location = {
      uri: 'file:///project/src/utils.ts',
      range: { start: { line: 41, character: 4 }, end: { line: 41, character: 20 } },
    }
    const result = formatDefinitionResult(loc, CWD)
    expect(result).toBe('Defined in src/utils.ts:42:5')
  })

  test('array of Locations', () => {
    const locs: Location[] = [
      {
        uri: 'file:///project/src/a.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      },
      {
        uri: 'file:///project/src/b.ts',
        range: { start: { line: 9, character: 0 }, end: { line: 9, character: 10 } },
      },
    ]
    const result = formatDefinitionResult(locs, CWD)
    expect(result).toContain('Found 2 definitions')
    expect(result).toContain('src/a.ts:1:1')
    expect(result).toContain('src/b.ts:10:1')
  })

  test('LocationLink result is normalized', () => {
    const link: LocationLink = {
      targetUri: 'file:///project/src/target.ts',
      targetRange: { start: { line: 5, character: 2 }, end: { line: 5, character: 20 } },
      targetSelectionRange: { start: { line: 5, character: 4 }, end: { line: 5, character: 15 } },
    }
    const result = formatDefinitionResult(link, CWD)
    // Should use targetSelectionRange when available
    expect(result).toBe('Defined in src/target.ts:6:5')
  })

  test('LocationLink without targetSelectionRange uses targetRange', () => {
    const link: LocationLink = {
      targetUri: 'file:///project/src/target.ts',
      targetRange: { start: { line: 5, character: 2 }, end: { line: 5, character: 20 } },
      targetSelectionRange: { start: { line: 5, character: 2 }, end: { line: 5, character: 20 } },
    }
    const result = formatDefinitionResult(link, CWD)
    expect(result).toBe('Defined in src/target.ts:6:3')
  })

  test('deeply nested paths use absolute when relative is too long', () => {
    const loc: Location = {
      uri: 'file:///other/deeply/nested/file.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    }
    const result = formatDefinitionResult(loc, CWD)
    // Relative would be ../../other/deeply/nested/file.ts (too many ..)
    expect(result).toContain('/other/deeply/nested/file.ts')
  })
})

// ---------------------------------------------------------------------------
// findReferences
// ---------------------------------------------------------------------------

describe('formatReferencesResult', () => {
  test('null result returns helpful message', () => {
    const result = formatReferencesResult(null, CWD)
    expect(result).toContain('No references found')
  })

  test('empty array returns helpful message', () => {
    const result = formatReferencesResult([], CWD)
    expect(result).toContain('No references found')
  })

  test('single reference', () => {
    const refs: Location[] = [
      {
        uri: 'file:///project/src/main.ts',
        range: { start: { line: 14, character: 2 }, end: { line: 14, character: 10 } },
      },
    ]
    const result = formatReferencesResult(refs, CWD)
    expect(result).toContain('Found 1 reference across 1 file')
    expect(result).toContain('src/main.ts')
    expect(result).toContain('Line 15:3')
  })

  test('multiple references grouped by file', () => {
    const refs: Location[] = [
      {
        uri: 'file:///project/src/a.ts',
        range: { start: { line: 14, character: 2 }, end: { line: 14, character: 10 } },
      },
      {
        uri: 'file:///project/src/a.ts',
        range: { start: { line: 41, character: 9 }, end: { line: 41, character: 20 } },
      },
      {
        uri: 'file:///project/src/b.ts',
        range: { start: { line: 7, character: 4 }, end: { line: 7, character: 15 } },
      },
    ]
    const result = formatReferencesResult(refs, CWD)
    expect(result).toContain('Found 3 references across 2 files')
    expect(result).toContain('src/a.ts')
    expect(result).toContain('Line 15:3')
    expect(result).toContain('Line 42:10')
    expect(result).toContain('src/b.ts')
    expect(result).toContain('Line 8:5')
  })
})

// ---------------------------------------------------------------------------
// hover
// ---------------------------------------------------------------------------

describe('formatHoverResult', () => {
  test('null result returns helpful message', () => {
    const result = formatHoverResult(null, 42, 5)
    expect(result).toContain('No hover information')
  })

  test('MarkupContent with markdown', () => {
    const hover: Hover = {
      contents: { kind: 'markdown', value: '```typescript\nconst x: number\n```' },
    }
    const result = formatHoverResult(hover, 42, 5)
    expect(result).toContain('Hover info at 42:5')
    expect(result).toContain('const x: number')
  })

  test('MarkupContent with plaintext', () => {
    const hover: Hover = {
      contents: { kind: 'plaintext', value: 'function foo(): void' },
    }
    const result = formatHoverResult(hover, 10, 3)
    expect(result).toContain('Hover info at 10:3')
    expect(result).toContain('function foo(): void')
  })

  test('MarkedString (plain string)', () => {
    const hover: Hover = {
      contents: 'Just a string hover',
    }
    const result = formatHoverResult(hover, 1, 1)
    expect(result).toContain('Just a string hover')
  })

  test('MarkedString array', () => {
    const hover: Hover = {
      contents: [
        { language: 'typescript', value: 'const x: number' },
        'A description',
      ],
    }
    const result = formatHoverResult(hover, 5, 10)
    expect(result).toContain('const x: number')
    expect(result).toContain('A description')
  })
})
