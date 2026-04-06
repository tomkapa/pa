import { describe, test, expect } from 'bun:test'
import {
  matchFilePattern,
  matchFilePatterns,
} from '../services/permissions/file-pattern-matching.js'

const ROOT = '/project'

// ---------------------------------------------------------------------------
// matchFilePattern
// ---------------------------------------------------------------------------

describe('matchFilePattern', () => {
  describe('basic glob patterns', () => {
    test('*.ts matches TypeScript files in root', () => {
      expect(matchFilePattern('/project/foo.ts', '*.ts', ROOT)).toBe(true)
      expect(matchFilePattern('/project/foo.js', '*.ts', ROOT)).toBe(false)
    })

    test('src/**/*.ts matches TypeScript files recursively under src/', () => {
      expect(matchFilePattern('/project/src/foo.ts', 'src/**/*.ts', ROOT)).toBe(true)
      expect(matchFilePattern('/project/src/deep/bar.ts', 'src/**/*.ts', ROOT)).toBe(true)
      expect(matchFilePattern('/project/src/foo.js', 'src/**/*.ts', ROOT)).toBe(false)
      expect(matchFilePattern('/project/lib/foo.ts', 'src/**/*.ts', ROOT)).toBe(false)
    })

    test('** matches everything recursively', () => {
      expect(matchFilePattern('/project/any/thing/at/all.txt', '**', ROOT)).toBe(true)
    })
  })

  describe('directory patterns', () => {
    test('src/** matches all files under src/', () => {
      expect(matchFilePattern('/project/src/index.ts', 'src/**', ROOT)).toBe(true)
      expect(matchFilePattern('/project/src/deep/file.ts', 'src/**', ROOT)).toBe(true)
      expect(matchFilePattern('/project/lib/index.ts', 'src/**', ROOT)).toBe(false)
    })

    test('.env matches dotfile', () => {
      expect(matchFilePattern('/project/.env', '.env', ROOT)).toBe(true)
      expect(matchFilePattern('/project/.env.local', '.env', ROOT)).toBe(false)
    })

    test('.env* matches all env files', () => {
      expect(matchFilePattern('/project/.env', '.env*', ROOT)).toBe(true)
      expect(matchFilePattern('/project/.env.local', '.env*', ROOT)).toBe(true)
    })
  })

  describe('relative paths', () => {
    test('works with relative file paths', () => {
      expect(matchFilePattern('src/foo.ts', 'src/**/*.ts', ROOT)).toBe(true)
    })
  })

  describe('paths outside root directory', () => {
    test('returns false for paths outside root', () => {
      expect(matchFilePattern('/other/project/foo.ts', '**/*.ts', ROOT)).toBe(false)
    })

    test('returns false for parent directory traversal', () => {
      expect(matchFilePattern('/foo.ts', '**/*.ts', ROOT)).toBe(false)
    })
  })

  describe('specific file patterns', () => {
    test('exact relative path', () => {
      expect(matchFilePattern('/project/src/main.ts', 'src/main.ts', ROOT)).toBe(true)
      expect(matchFilePattern('/project/src/other.ts', 'src/main.ts', ROOT)).toBe(false)
    })
  })

  describe('acceptance criteria', () => {
    test('Edit(src/**/*.ts) matches TypeScript files recursively', () => {
      expect(matchFilePattern('/project/src/foo.ts', 'src/**/*.ts', ROOT)).toBe(true)
      expect(matchFilePattern('/project/src/a/b/c.ts', 'src/**/*.ts', ROOT)).toBe(true)
      expect(matchFilePattern('/project/src/foo.js', 'src/**/*.ts', ROOT)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// matchFilePatterns
// ---------------------------------------------------------------------------

describe('matchFilePatterns', () => {
  test('matches if any pattern matches', () => {
    expect(
      matchFilePatterns('/project/src/foo.ts', ['*.js', '*.ts'], ROOT),
    ).toBe(true)
  })

  test('returns false if no patterns match', () => {
    expect(
      matchFilePatterns('/project/src/foo.py', ['*.js', '*.ts'], ROOT),
    ).toBe(false)
  })

  test('returns false for empty patterns array', () => {
    expect(matchFilePatterns('/project/src/foo.ts', [], ROOT)).toBe(false)
  })

  test('handles multiple complex patterns', () => {
    const patterns = ['src/**/*.ts', 'lib/**/*.js', '*.json']
    expect(matchFilePatterns('/project/src/a.ts', patterns, ROOT)).toBe(true)
    expect(matchFilePatterns('/project/lib/b.js', patterns, ROOT)).toBe(true)
    expect(matchFilePatterns('/project/config.json', patterns, ROOT)).toBe(true)
    expect(matchFilePatterns('/project/src/a.py', patterns, ROOT)).toBe(false)
  })
})
