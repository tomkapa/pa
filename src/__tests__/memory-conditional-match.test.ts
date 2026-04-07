import { describe, test, expect } from 'bun:test'
import path from 'node:path'
import {
  matchesConditionalRule,
  filterConditionalMatches,
} from '../services/memory/conditional-match.js'
import type { MemoryFileInfo } from '../services/memory/types.js'

const baseDir = '/project'

function rule(globs: string[] | undefined): MemoryFileInfo {
  return {
    path: path.join(baseDir, '.claude/rules/r.md'),
    type: 'Project',
    content: '# rule',
    globs,
  }
}

describe('matchesConditionalRule', () => {
  test('returns false when file has no globs', () => {
    expect(
      matchesConditionalRule(rule(undefined), '/project/src/foo.ts', baseDir),
    ).toBe(false)
  })

  test('returns false when globs is empty', () => {
    expect(
      matchesConditionalRule(rule([]), '/project/src/foo.ts', baseDir),
    ).toBe(false)
  })

  test('matches a simple star pattern', () => {
    expect(
      matchesConditionalRule(rule(['src/*.ts']), '/project/src/foo.ts', baseDir),
    ).toBe(true)
  })

  test('does not match files outside the pattern', () => {
    expect(
      matchesConditionalRule(rule(['src/*.ts']), '/project/test/foo.ts', baseDir),
    ).toBe(false)
  })

  test('matches a recursive globstar', () => {
    expect(
      matchesConditionalRule(
        rule(['src/**/*.ts']),
        '/project/src/deep/nested/foo.ts',
        baseDir,
      ),
    ).toBe(true)
  })

  test('matches when one of multiple patterns matches', () => {
    expect(
      matchesConditionalRule(
        rule(['src/*.ts', 'test/*.ts']),
        '/project/test/foo.ts',
        baseDir,
      ),
    ).toBe(true)
  })

  test('returns false when target is outside baseDir', () => {
    expect(
      matchesConditionalRule(
        rule(['src/*.ts']),
        '/elsewhere/src/foo.ts',
        baseDir,
      ),
    ).toBe(false)
  })

  test('returns false for relative target paths', () => {
    expect(matchesConditionalRule(rule(['src/*.ts']), 'src/foo.ts', baseDir)).toBe(
      false,
    )
  })
})

describe('filterConditionalMatches', () => {
  test('returns only files whose patterns match', () => {
    const ruleA = rule(['src/*.ts'])
    const ruleB = rule(['test/*.ts'])
    const ruleC = rule(undefined)
    const result = filterConditionalMatches(
      [ruleA, ruleB, ruleC],
      '/project/src/foo.ts',
      baseDir,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(ruleA)
  })

  test('returns empty when nothing matches', () => {
    const result = filterConditionalMatches(
      [rule(['src/*.ts'])],
      '/project/test/foo.ts',
      baseDir,
    )
    expect(result).toEqual([])
  })
})
