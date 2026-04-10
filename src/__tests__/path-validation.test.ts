import { describe, test, expect } from 'bun:test'
import {
  extractToolPaths,
  getDangerousPathReason,
  isSensitivePath,
  isWithinDirectory,
  checkReadOnlyPath,
} from '../services/permissions/path-validation.js'

// ---------------------------------------------------------------------------
// extractToolPaths
// ---------------------------------------------------------------------------

describe('extractToolPaths', () => {
  test('extracts file_path from Read-style input', () => {
    expect(extractToolPaths({ file_path: '/tmp/foo.ts' })).toEqual(['/tmp/foo.ts'])
  })

  test('extracts path from Grep/Glob-style input', () => {
    expect(extractToolPaths({ pattern: '*.ts', path: '/src' })).toEqual(['/src'])
  })

  test('extracts both file_path and path if present', () => {
    const paths = extractToolPaths({ file_path: '/a', path: '/b' })
    expect(paths).toEqual(['/a', '/b'])
  })

  test('returns empty array for input without path fields', () => {
    expect(extractToolPaths({ command: 'ls' })).toEqual([])
  })

  test('returns empty array for non-object input', () => {
    expect(extractToolPaths('hello')).toEqual([])
    expect(extractToolPaths(null)).toEqual([])
    expect(extractToolPaths(42)).toEqual([])
    expect(extractToolPaths(undefined)).toEqual([])
  })

  test('returns empty array for array input', () => {
    expect(extractToolPaths([{ file_path: '/foo' }])).toEqual([])
  })

  test('ignores non-string path values', () => {
    expect(extractToolPaths({ file_path: 42 })).toEqual([])
    expect(extractToolPaths({ path: true })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getDangerousPathReason
// ---------------------------------------------------------------------------

describe('getDangerousPathReason', () => {
  test('detects UNC paths with backslashes', () => {
    const reason = getDangerousPathReason('\\\\server\\share\\file.txt')
    expect(reason).toContain('UNC')
  })

  test('detects UNC paths with forward slashes', () => {
    const reason = getDangerousPathReason('//server/share/file.txt')
    expect(reason).toContain('UNC')
  })

  test('detects tilde expansion ~root', () => {
    const reason = getDangerousPathReason('~root/.bashrc')
    expect(reason).toContain('Tilde')
  })

  test('detects tilde expansion ~+', () => {
    const reason = getDangerousPathReason('~+/file.txt')
    expect(reason).toContain('Tilde')
  })

  test('detects tilde expansion ~-', () => {
    const reason = getDangerousPathReason('~-/file.txt')
    expect(reason).toContain('Tilde')
  })

  test('detects dollar sign shell expansion', () => {
    const reason = getDangerousPathReason('/tmp/$HOME/file.txt')
    expect(reason).toContain('shell expansion')
  })

  test('detects percent shell expansion', () => {
    const reason = getDangerousPathReason('/tmp/%userprofile%/file.txt')
    expect(reason).toContain('shell expansion')
  })

  test('detects backtick shell expansion', () => {
    const reason = getDangerousPathReason('/tmp/`whoami`/file.txt')
    expect(reason).toContain('shell expansion')
  })

  test('allows plain tilde home expansion ~/path', () => {
    expect(getDangerousPathReason('~/Documents/file.txt')).toBeNull()
  })

  test('allows bare tilde ~', () => {
    expect(getDangerousPathReason('~')).toBeNull()
  })

  test('allows absolute paths', () => {
    expect(getDangerousPathReason('/home/user/file.txt')).toBeNull()
  })

  test('allows relative paths', () => {
    expect(getDangerousPathReason('src/index.ts')).toBeNull()
  })

  test('allows paths with dots', () => {
    expect(getDangerousPathReason('./foo/../bar/baz.ts')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isSensitivePath
// ---------------------------------------------------------------------------

describe('isSensitivePath', () => {
  test('matches .env file', () => {
    expect(isSensitivePath('/project/.env')).toBe(true)
  })

  test('matches .env.local variant', () => {
    expect(isSensitivePath('/project/.env.local')).toBe(true)
  })

  test('matches .ssh directory', () => {
    expect(isSensitivePath('/home/user/.ssh/config')).toBe(true)
  })

  test('matches credentials file', () => {
    expect(isSensitivePath('/project/credentials.json')).toBe(true)
  })

  test('matches private.key file', () => {
    expect(isSensitivePath('/certs/private.key')).toBe(true)
  })

  test('matches .netrc file', () => {
    expect(isSensitivePath('/home/user/.netrc')).toBe(true)
  })

  test('matches .npmrc file', () => {
    expect(isSensitivePath('/home/user/.npmrc')).toBe(true)
  })

  test('matches .pgpass file', () => {
    expect(isSensitivePath('/home/user/.pgpass')).toBe(true)
  })

  test('matches id_rsa key', () => {
    expect(isSensitivePath('/home/user/.ssh/id_rsa')).toBe(true)
  })

  test('matches id_ed25519 key', () => {
    expect(isSensitivePath('/home/user/.ssh/id_ed25519')).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(isSensitivePath('/project/.ENV')).toBe(true)
    expect(isSensitivePath('/project/CREDENTIALS')).toBe(true)
  })

  test('does not match normal source files', () => {
    expect(isSensitivePath('/project/src/index.ts')).toBe(false)
  })

  test('does not match package.json', () => {
    expect(isSensitivePath('/project/package.json')).toBe(false)
  })

  test('does not match README', () => {
    expect(isSensitivePath('/project/README.md')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isWithinDirectory
// ---------------------------------------------------------------------------

describe('isWithinDirectory', () => {
  test('file directly in directory is within', () => {
    expect(isWithinDirectory('/project/file.ts', '/project')).toBe(true)
  })

  test('file in subdirectory is within', () => {
    expect(isWithinDirectory('/project/src/index.ts', '/project')).toBe(true)
  })

  test('directory itself is within', () => {
    expect(isWithinDirectory('/project', '/project')).toBe(true)
  })

  test('file outside directory is not within', () => {
    expect(isWithinDirectory('/tmp/file.ts', '/project')).toBe(false)
  })

  test('sibling directory is not within', () => {
    expect(isWithinDirectory('/project-other/file.ts', '/project')).toBe(false)
  })

  test('parent directory is not within', () => {
    expect(isWithinDirectory('/home', '/home/user/project')).toBe(false)
  })

  test('handles trailing slashes on base', () => {
    expect(isWithinDirectory('/project/file.ts', '/project/')).toBe(true)
  })

  test('handles trailing slashes on path', () => {
    expect(isWithinDirectory('/project/src/', '/project')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// checkReadOnlyPath
// ---------------------------------------------------------------------------

describe('checkReadOnlyPath', () => {
  const cwd = process.cwd()

  test('returns null for safe path within CWD', () => {
    expect(checkReadOnlyPath(`${cwd}/src/index.ts`, cwd)).toBeNull()
  })

  test('returns null for relative path (resolves to within CWD)', () => {
    expect(checkReadOnlyPath('src/index.ts', cwd)).toBeNull()
  })

  test('returns dangerous for UNC path', () => {
    const result = checkReadOnlyPath('\\\\server\\share', cwd)
    expect(result?.type).toBe('dangerous')
  })

  test('returns dangerous for tilde variant', () => {
    const result = checkReadOnlyPath('~root/.bashrc', cwd)
    expect(result?.type).toBe('dangerous')
  })

  test('returns sensitive for .env file', () => {
    const result = checkReadOnlyPath(`${cwd}/.env`, cwd)
    expect(result?.type).toBe('sensitive')
  })

  test('returns sensitive for credentials file', () => {
    const result = checkReadOnlyPath(`${cwd}/credentials.json`, cwd)
    expect(result?.type).toBe('sensitive')
  })

  test('returns outside-cwd for path outside CWD', () => {
    const result = checkReadOnlyPath('/etc/passwd', cwd)
    expect(result?.type).toBe('outside-cwd')
  })

  test('returns outside-cwd for home directory path', () => {
    const result = checkReadOnlyPath('~/Documents/file.txt', cwd)
    expect(result?.type).toBe('outside-cwd')
  })

  test('dangerous check runs before sensitive check', () => {
    // Path with both shell expansion and .env — should return dangerous
    const result = checkReadOnlyPath('$HOME/.env', cwd)
    expect(result?.type).toBe('dangerous')
  })
})
