import { describe, expect, test } from 'bun:test'
import {
  formatFileContentWithLineNumbers,
  stripLineNumberPrefix,
} from '../utils/file.js'

describe('formatFileContentWithLineNumbers', () => {
  test('formats single line with line number and tab', () => {
    expect(formatFileContentWithLineNumbers('hello')).toBe('1\thello')
  })

  test('formats multiple lines', () => {
    const input = 'line one\nline two\nline three'
    const expected = '1\tline one\n2\tline two\n3\tline three'
    expect(formatFileContentWithLineNumbers(input)).toBe(expected)
  })

  test('returns empty string for empty input', () => {
    expect(formatFileContentWithLineNumbers('')).toBe('')
  })

  test('handles offset parameter', () => {
    const input = 'alpha\nbeta'
    const expected = '5\talpha\n6\tbeta'
    expect(formatFileContentWithLineNumbers(input, 5)).toBe(expected)
  })

  test('preserves blank lines', () => {
    const input = 'a\n\nb'
    const expected = '1\ta\n2\t\n3\tb'
    expect(formatFileContentWithLineNumbers(input)).toBe(expected)
  })

  test('handles content with tabs', () => {
    const input = '\tindented'
    expect(formatFileContentWithLineNumbers(input)).toBe('1\t\tindented')
  })

  test('handles trailing newline', () => {
    const input = 'line1\nline2\n'
    const expected = '1\tline1\n2\tline2\n3\t'
    expect(formatFileContentWithLineNumbers(input)).toBe(expected)
  })
})

describe('stripLineNumberPrefix', () => {
  test('strips line number and tab prefix', () => {
    expect(stripLineNumberPrefix('1\thello world')).toBe('hello world')
  })

  test('strips multi-digit line numbers', () => {
    expect(stripLineNumberPrefix('42\tsome code')).toBe('some code')
  })

  test('strips with leading whitespace before line number', () => {
    expect(stripLineNumberPrefix('  10\tcontent')).toBe('content')
  })

  test('returns original string if no line number prefix', () => {
    expect(stripLineNumberPrefix('no prefix here')).toBe('no prefix here')
  })

  test('handles empty content after prefix', () => {
    expect(stripLineNumberPrefix('5\t')).toBe('')
  })

  test('preserves tabs in actual content', () => {
    expect(stripLineNumberPrefix('1\t\tindented')).toBe('\tindented')
  })
})
