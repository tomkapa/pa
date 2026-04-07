import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  loadMemory,
  walkUpFromCwd,
  getManagedRoot,
  getMemory,
  invalidateMemoryCache,
} from '../services/memory/loader.js'

// Use the OS tmpdir so the ancestor walk in loadMemory doesn't accidentally
// pick up the real project's CLAUDE.md or any user CLAUDE.md files between
// the test fixture and the filesystem root.
let tempRoot: string

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'memory-loader-'))
  invalidateMemoryCache()
})

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true })
  invalidateMemoryCache()
})

function write(rel: string, content: string): string {
  const full = path.join(tempRoot, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return full
}

function ensureDir(rel: string): string {
  const full = path.join(tempRoot, rel)
  mkdirSync(full, { recursive: true })
  return full
}

// ---------------------------------------------------------------------------
// getManagedRoot
// ---------------------------------------------------------------------------

describe('getManagedRoot', () => {
  test('returns macOS path for darwin', () => {
    expect(getManagedRoot('darwin')).toBe(
      '/Library/Application Support/ClaudeCode',
    )
  })

  test('returns Linux path for linux', () => {
    expect(getManagedRoot('linux')).toBe('/etc/claude-code')
  })

  test('returns Windows path for win32', () => {
    expect(getManagedRoot('win32')).toBe('C:\\ProgramData\\ClaudeCode')
  })
})

// ---------------------------------------------------------------------------
// walkUpFromCwd
// ---------------------------------------------------------------------------

describe('walkUpFromCwd', () => {
  test('returns ancestors in root-first order', () => {
    const result = walkUpFromCwd('/a/b/c')
    expect(result[0]).toBe('/')
    expect(result[result.length - 1]).toBe('/a/b/c')
    expect(result).toContain('/a')
    expect(result).toContain('/a/b')
  })

  test('handles a root path', () => {
    const result = walkUpFromCwd('/')
    expect(result).toEqual(['/'])
  })
})

// ---------------------------------------------------------------------------
// loadMemory — integration tests using a sandboxed filesystem
// ---------------------------------------------------------------------------

describe('loadMemory', () => {
  test('returns empty when no CLAUDE.md files exist anywhere', async () => {
    const cwd = ensureDir('proj')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')
    const result = await loadMemory({ cwd, home, managedRoot })
    // Some entries may exist for the cwd ancestors but they should all be empty.
    expect(result.unconditional).toEqual([])
    expect(result.conditional).toEqual([])
  })

  test('loads project CLAUDE.md from cwd', async () => {
    const cwd = ensureDir('proj')
    write('proj/CLAUDE.md', '# Project rules\n')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')

    const result = await loadMemory({ cwd, home, managedRoot })
    expect(result.unconditional).toHaveLength(1)
    expect(result.unconditional[0]!.type).toBe('Project')
    expect(result.unconditional[0]!.content).toBe('# Project rules\n')
  })

  test('loads CLAUDE.local.md as Local type', async () => {
    const cwd = ensureDir('proj')
    write('proj/CLAUDE.local.md', '# Local\n')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')

    const result = await loadMemory({ cwd, home, managedRoot })
    expect(result.unconditional).toHaveLength(1)
    expect(result.unconditional[0]!.type).toBe('Local')
  })

  test('loads user CLAUDE.md from ~/.claude as User type', async () => {
    const cwd = ensureDir('proj')
    const home = ensureDir('home')
    write('home/.claude/CLAUDE.md', '# User\n')
    const managedRoot = ensureDir('managed')

    const result = await loadMemory({ cwd, home, managedRoot })
    expect(result.unconditional).toHaveLength(1)
    expect(result.unconditional[0]!.type).toBe('User')
  })

  test('loads managed CLAUDE.md as Managed type', async () => {
    const cwd = ensureDir('proj')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')
    write('managed/CLAUDE.md', '# Managed\n')

    const result = await loadMemory({ cwd, home, managedRoot })
    expect(result.unconditional).toHaveLength(1)
    expect(result.unconditional[0]!.type).toBe('Managed')
  })

  test('orders Managed → User → Project → Local', async () => {
    const cwd = ensureDir('proj')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')
    write('managed/CLAUDE.md', '# Managed\n')
    write('home/.claude/CLAUDE.md', '# User\n')
    write('proj/CLAUDE.md', '# Project\n')
    write('proj/CLAUDE.local.md', '# Local\n')

    const result = await loadMemory({ cwd, home, managedRoot })
    const types = result.unconditional.map(f => f.type)
    expect(types).toEqual(['Managed', 'User', 'Project', 'Local'])
  })

  test('walks up from cwd and finds CLAUDE.md in ancestors', async () => {
    ensureDir('proj/sub/inner')
    write('proj/CLAUDE.md', '# proj\n')
    write('proj/sub/CLAUDE.md', '# sub\n')
    write('proj/sub/inner/CLAUDE.md', '# inner\n')

    const cwd = path.join(tempRoot, 'proj/sub/inner')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')

    const result = await loadMemory({ cwd, home, managedRoot })
    const projectFiles = result.unconditional.filter(f => f.type === 'Project')
    // Order: root first, cwd last.
    expect(projectFiles.map(f => f.content)).toEqual([
      '# proj\n',
      '# sub\n',
      '# inner\n',
    ])
  })

  test('loads .claude/CLAUDE.md from a directory', async () => {
    const cwd = ensureDir('proj')
    write('proj/.claude/CLAUDE.md', '# project from .claude\n')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')

    const result = await loadMemory({ cwd, home, managedRoot })
    expect(result.unconditional).toHaveLength(1)
    expect(result.unconditional[0]!.type).toBe('Project')
    expect(result.unconditional[0]!.content).toBe('# project from .claude\n')
  })

  test('loads unconditional rules from .claude/rules/', async () => {
    const cwd = ensureDir('proj')
    write('proj/.claude/rules/style.md', '# Style rules\n')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')

    const result = await loadMemory({ cwd, home, managedRoot })
    const rules = result.unconditional.filter(
      f => f.path.includes('.claude/rules/'),
    )
    expect(rules).toHaveLength(1)
    expect(rules[0]!.type).toBe('Project')
    expect(rules[0]!.globs).toBeUndefined()
  })

  test('loads conditional rules from .claude/rules/ into the conditional list', async () => {
    const cwd = ensureDir('proj')
    write(
      'proj/.claude/rules/ts.md',
      '---\npaths: src/**/*.ts\n---\n# TS only\n',
    )
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')

    const result = await loadMemory({ cwd, home, managedRoot })
    expect(result.conditional).toHaveLength(1)
    expect(result.conditional[0]!.globs).toEqual(['src/**/*.ts'])
    // Conditional rules do NOT appear in the unconditional list.
    const inUncond = result.unconditional.some(f => f.path.includes('ts.md'))
    expect(inUncond).toBe(false)
  })

  test('@includes are followed and inherit parent type', async () => {
    const cwd = ensureDir('proj')
    write('proj/extra.md', '# Extra rules\n')
    write('proj/CLAUDE.md', '# Main\n@./extra.md\n')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')

    const result = await loadMemory({ cwd, home, managedRoot })
    expect(result.unconditional).toHaveLength(2)
    expect(result.unconditional[0]!.path).toContain('CLAUDE.md')
    expect(result.unconditional[1]!.path).toContain('extra.md')
    expect(result.unconditional[1]!.parent).toContain('CLAUDE.md')
    expect(result.unconditional[1]!.type).toBe('Project')
  })

  test('does not load missing files', async () => {
    const cwd = ensureDir('proj')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')
    const result = await loadMemory({ cwd, home, managedRoot })
    expect(result.unconditional).toEqual([])
    expect(result.conditional).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getMemory (memoized variant)
// ---------------------------------------------------------------------------

describe('getMemory (memoized)', () => {
  test('returns the same promise for repeated calls', async () => {
    const cwd = ensureDir('proj')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')
    write('proj/CLAUDE.md', '# x\n')

    const a = getMemory({ cwd, home, managedRoot })
    const b = getMemory({ cwd, home, managedRoot })
    expect(a).toBe(b)

    const ra = await a
    const rb = await b
    expect(ra).toBe(rb)
  })

  test('invalidateMemoryCache forces a fresh load', async () => {
    const cwd = ensureDir('proj')
    const home = ensureDir('home')
    const managedRoot = ensureDir('managed')
    write('proj/CLAUDE.md', '# v1\n')
    const first = await getMemory({ cwd, home, managedRoot })
    expect(first.unconditional[0]!.content).toBe('# v1\n')

    write('proj/CLAUDE.md', '# v2\n')
    const stale = await getMemory({ cwd, home, managedRoot })
    expect(stale.unconditional[0]!.content).toBe('# v1\n') // cached

    invalidateMemoryCache()
    const fresh = await getMemory({ cwd, home, managedRoot })
    expect(fresh.unconditional[0]!.content).toBe('# v2\n')
  })
})
