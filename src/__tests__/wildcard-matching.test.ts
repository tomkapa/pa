import { describe, test, expect } from 'bun:test'
import {
  matchWildcardPattern,
  matchLegacyPrefix,
  hasWildcard,
} from '../services/permissions/wildcard-matching.js'

// ---------------------------------------------------------------------------
// matchWildcardPattern
// ---------------------------------------------------------------------------

describe('matchWildcardPattern', () => {
  describe('basic wildcards', () => {
    test('* at end matches any suffix', () => {
      expect(matchWildcardPattern('npm install', 'npm *')).toBe(true)
      expect(matchWildcardPattern('npm run test', 'npm *')).toBe(true)
      expect(matchWildcardPattern('npm', 'npm *')).toBe(true) // trailing space+star is optional
    })

    test('* in the middle matches any infix', () => {
      expect(matchWildcardPattern('git checkout main', 'git * main')).toBe(true)
      expect(matchWildcardPattern('git push origin main', 'git * main')).toBe(true)
      expect(matchWildcardPattern('git rebase main', 'git * main')).toBe(true)
    })

    test('* at the beginning matches any prefix', () => {
      expect(matchWildcardPattern('foo bar baz', '* baz')).toBe(true)
      expect(matchWildcardPattern('baz', '* baz')).toBe(false) // no space before baz
    })

    test('multiple wildcards', () => {
      expect(matchWildcardPattern('a b c d', 'a * c *')).toBe(true)
      expect(matchWildcardPattern('a x c y z', 'a * c *')).toBe(true)
    })

    test('pattern with only * matches everything', () => {
      // Note: in the rule parser, Bash(*) is collapsed to tool-level.
      // This tests the raw matching function.
      expect(matchWildcardPattern('anything at all', '*')).toBe(true)
      expect(matchWildcardPattern('', '*')).toBe(true)
    })
  })

  describe('trailing space+star optionality', () => {
    test('npm * matches npm alone (no subcommand)', () => {
      expect(matchWildcardPattern('npm', 'npm *')).toBe(true)
    })

    test('npm * matches npm with subcommand', () => {
      expect(matchWildcardPattern('npm install', 'npm *')).toBe(true)
    })

    test('npm * does not match npx', () => {
      expect(matchWildcardPattern('npx', 'npm *')).toBe(false)
    })

    test('git * matches git alone', () => {
      expect(matchWildcardPattern('git', 'git *')).toBe(true)
    })

    test('git * matches git with subcommand', () => {
      expect(matchWildcardPattern('git status', 'git *')).toBe(true)
    })
  })

  describe('escaped characters', () => {
    test('\\* matches literal asterisk', () => {
      expect(matchWildcardPattern('*', '\\*')).toBe(true)
      expect(matchWildcardPattern('x', '\\*')).toBe(false)
      expect(matchWildcardPattern('abc', '\\*')).toBe(false)
    })

    test('echo \\* matches echo followed by literal star', () => {
      expect(matchWildcardPattern('echo *', 'echo \\*')).toBe(true)
      expect(matchWildcardPattern('echo foo', 'echo \\*')).toBe(false)
    })

    test('\\\\ matches literal backslash', () => {
      expect(matchWildcardPattern('\\', '\\\\')).toBe(true)
      expect(matchWildcardPattern('x', '\\\\')).toBe(false)
    })

    test('mixed escaped and unescaped stars', () => {
      // Pattern: echo \* * → matches "echo * anything"
      expect(matchWildcardPattern('echo * hello', 'echo \\* *')).toBe(true)
      expect(matchWildcardPattern('echo *', 'echo \\* *')).toBe(true) // trailing space+star optional
      expect(matchWildcardPattern('echo foo hello', 'echo \\* *')).toBe(false) // foo ≠ *
    })
  })

  describe('exact match (no wildcards)', () => {
    test('exact string matches itself', () => {
      expect(matchWildcardPattern('git status', 'git status')).toBe(true)
    })

    test('exact string does not match different string', () => {
      expect(matchWildcardPattern('git push', 'git status')).toBe(false)
    })
  })

  describe('case sensitivity', () => {
    test('case-sensitive by default', () => {
      expect(matchWildcardPattern('NPM install', 'npm *')).toBe(false)
    })

    test('case-insensitive when flag is set', () => {
      expect(matchWildcardPattern('NPM install', 'npm *', true)).toBe(true)
      expect(matchWildcardPattern('Get-Process', 'get-process', true)).toBe(true)
    })
  })

  describe('edge cases', () => {
    test('empty pattern matches empty input', () => {
      expect(matchWildcardPattern('', '')).toBe(true)
    })

    test('empty pattern does not match non-empty input', () => {
      expect(matchWildcardPattern('something', '')).toBe(false)
    })

    test('pattern with regex metacharacters is treated as literal', () => {
      expect(matchWildcardPattern('echo (test)', 'echo (test)')).toBe(true)
      expect(matchWildcardPattern('echo test', 'echo (test)')).toBe(false)
    })

    test('pattern with dots is treated as literal', () => {
      expect(matchWildcardPattern('cat file.txt', 'cat file.txt')).toBe(true)
      expect(matchWildcardPattern('cat filextxt', 'cat file.txt')).toBe(false)
    })

    test('pattern with brackets is treated as literal', () => {
      expect(matchWildcardPattern('echo [test]', 'echo [test]')).toBe(true)
    })
  })

  describe('acceptance criteria from tech notes', () => {
    test('Bash(npm *) matches npm, npm install, npm run test, but NOT npx', () => {
      const pattern = 'npm *'
      expect(matchWildcardPattern('npm', pattern)).toBe(true)
      expect(matchWildcardPattern('npm install', pattern)).toBe(true)
      expect(matchWildcardPattern('npm run test', pattern)).toBe(true)
      expect(matchWildcardPattern('npx', pattern)).toBe(false)
    })

    test('Bash(git * main) matches git checkout main, git push origin main', () => {
      const pattern = 'git * main'
      expect(matchWildcardPattern('git checkout main', pattern)).toBe(true)
      expect(matchWildcardPattern('git push origin main', pattern)).toBe(true)
    })

    test('Bash(\\*) matches only a literal asterisk', () => {
      expect(matchWildcardPattern('*', '\\*')).toBe(true)
      expect(matchWildcardPattern('anything', '\\*')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// matchLegacyPrefix
// ---------------------------------------------------------------------------

describe('matchLegacyPrefix', () => {
  test('npm:* matches npm alone', () => {
    expect(matchLegacyPrefix('npm', 'npm:*')).toBe(true)
  })

  test('npm:* matches npm with args', () => {
    expect(matchLegacyPrefix('npm install', 'npm:*')).toBe(true)
  })

  test('npm:* does not match npx', () => {
    expect(matchLegacyPrefix('npx', 'npm:*')).toBe(false)
  })

  test('non-legacy pattern returns false', () => {
    expect(matchLegacyPrefix('npm install', 'npm *')).toBe(false)
    expect(matchLegacyPrefix('npm install', 'npm')).toBe(false)
  })

  test('git:* matches git and git subcommands', () => {
    expect(matchLegacyPrefix('git', 'git:*')).toBe(true)
    expect(matchLegacyPrefix('git status', 'git:*')).toBe(true)
    expect(matchLegacyPrefix('gitk', 'git:*')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasWildcard
// ---------------------------------------------------------------------------

describe('hasWildcard', () => {
  test('detects unescaped wildcard', () => {
    expect(hasWildcard('npm *')).toBe(true)
    expect(hasWildcard('*')).toBe(true)
    expect(hasWildcard('git * main')).toBe(true)
  })

  test('does not detect escaped wildcard', () => {
    expect(hasWildcard('echo \\*')).toBe(false)
  })

  test('detects mixed escaped and unescaped', () => {
    expect(hasWildcard('echo \\* *')).toBe(true)
  })

  test('no wildcards', () => {
    expect(hasWildcard('npm install')).toBe(false)
    expect(hasWildcard('git status')).toBe(false)
  })
})
