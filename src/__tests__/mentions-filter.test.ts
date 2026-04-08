import { describe, test, expect } from 'bun:test'
import { filterForToken } from '../services/mentions/filter.js'

describe('filterForToken', () => {
  const files = [
    'src/app.ts',
    'src/utils/file.ts',
    'src/utils/glob.ts',
    'src/components/text-input.tsx',
    'README.md',
    'package.json',
    'docs/guide.md',
  ]

  test('returns up to limit files when token is empty', () => {
    expect(filterForToken(files, '', 3)).toEqual(files.slice(0, 3))
  })

  test('returns all files when token is empty and fewer than limit', () => {
    expect(filterForToken(files, '', 100)).toEqual(files)
  })

  test('prefix match on basename beats contains match', () => {
    const result = filterForToken(files, 'gl', 15)
    expect(result[0]).toBe('src/utils/glob.ts')
  })

  test('prefix match on full path', () => {
    const result = filterForToken(files, 'src/ap', 15)
    expect(result).toContain('src/app.ts')
    expect(result[0]).toBe('src/app.ts')
  })

  test('contains match included when no prefix match', () => {
    const result = filterForToken(files, 'guide', 15)
    expect(result).toContain('docs/guide.md')
  })

  test('is case-insensitive', () => {
    const result = filterForToken(files, 'README', 15)
    expect(result).toContain('README.md')

    const lowerResult = filterForToken(files, 'readme', 15)
    expect(lowerResult).toContain('README.md')
  })

  test('respects limit cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => `file${i}.ts`)
    expect(filterForToken(many, '', 15).length).toBe(15)
    expect(filterForToken(many, 'file', 15).length).toBe(15)
  })

  test('returns empty array when no matches', () => {
    expect(filterForToken(files, 'zzzzz', 15)).toEqual([])
  })

  test('prefix hits come before contains hits', () => {
    // 'te' prefix-matches 'text-input.tsx' basename; 'latex.ts' contains 'te'
    const input = ['src/components/text-input.tsx', 'src/latex.ts', 'src/beta.ts']
    const result = filterForToken(input, 'te', 15)
    expect(result[0]).toBe('src/components/text-input.tsx')
    expect(result).toContain('src/latex.ts')
  })
})
