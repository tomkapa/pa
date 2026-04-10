import { describe, test, expect } from 'bun:test'
import {
  substituteArguments,
  parseArgNames,
} from '../../services/custom-commands/arguments.js'

describe('substituteArguments', () => {
  test('substitutes $ARGUMENTS with full args string', () => {
    const result = substituteArguments('Review: $ARGUMENTS', 'src/main.ts', [])
    expect(result).toBe('Review: src/main.ts')
  })

  test('substitutes $ARGUMENTS multiple times', () => {
    const result = substituteArguments(
      'First: $ARGUMENTS, Second: $ARGUMENTS',
      'hello',
      [],
    )
    expect(result).toBe('First: hello, Second: hello')
  })

  test('substitutes indexed $ARGUMENTS[0], $ARGUMENTS[1]', () => {
    const result = substituteArguments(
      'Source: $ARGUMENTS[0], Dest: $ARGUMENTS[1]',
      'foo bar',
      [],
    )
    expect(result).toBe('Source: foo, Dest: bar')
  })

  test('substitutes $0, $1 shorthand', () => {
    const result = substituteArguments('Copy $0 to $1', 'src dest', [])
    expect(result).toBe('Copy src to dest')
  })

  test('substitutes named arguments', () => {
    const result = substituteArguments(
      'Copy $source to $dest',
      'foo bar',
      ['source', 'dest'],
    )
    expect(result).toBe('Copy foo to bar')
  })

  test('handles quoted arguments in shell-style', () => {
    const result = substituteArguments(
      'Review: $ARGUMENTS[0]',
      '"hello world" second',
      [],
    )
    expect(result).toBe('Review: hello world')
  })

  test('appends fallback when no placeholder found', () => {
    const result = substituteArguments(
      'Just a plain prompt',
      'some args here',
      [],
    )
    expect(result).toBe('Just a plain prompt\n\nARGUMENTS: some args here')
  })

  test('does not append fallback when args are empty', () => {
    const result = substituteArguments('Just a plain prompt', '', [])
    expect(result).toBe('Just a plain prompt')
  })

  test('does not append fallback when args are whitespace', () => {
    const result = substituteArguments('Just a plain prompt', '   ', [])
    expect(result).toBe('Just a plain prompt')
  })

  test('handles missing named arg — substitutes empty string', () => {
    const result = substituteArguments(
      'Copy $source to $dest',
      'only-one-arg',
      ['source', 'dest'],
    )
    expect(result).toBe('Copy only-one-arg to ')
  })

  test('named args are substituted before indexed to avoid partial matches', () => {
    const result = substituteArguments(
      'File: $file, Index: $0',
      'test.ts',
      ['file'],
    )
    expect(result).toBe('File: test.ts, Index: test.ts')
  })

  test('handles empty content with args — appends fallback', () => {
    const result = substituteArguments('', 'some args', [])
    expect(result).toBe('\n\nARGUMENTS: some args')
  })

  test('handles empty content with empty args — returns empty', () => {
    const result = substituteArguments('', '', [])
    expect(result).toBe('')
  })
})

describe('parseArgNames', () => {
  test('parses space-separated string', () => {
    expect(parseArgNames('source dest mode')).toEqual(['source', 'dest', 'mode'])
  })

  test('parses array', () => {
    expect(parseArgNames(['source', 'dest'])).toEqual(['source', 'dest'])
  })

  test('returns empty array for undefined', () => {
    expect(parseArgNames(undefined)).toEqual([])
  })

  test('filters out purely numeric names', () => {
    expect(parseArgNames('source 0 dest 1')).toEqual(['source', 'dest'])
  })

  test('filters out numeric names from array', () => {
    expect(parseArgNames(['source', '0', 'dest', '1'])).toEqual(['source', 'dest'])
  })

  test('handles empty string', () => {
    expect(parseArgNames('')).toEqual([])
  })

  test('handles whitespace-only string', () => {
    expect(parseArgNames('   ')).toEqual([])
  })
})
