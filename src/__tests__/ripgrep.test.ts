import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ripGrep, RipgrepError, RipgrepTimeoutError } from '../utils/ripgrep.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pa-rg-test-'))
  await writeFile(join(tempDir, 'hello.ts'), 'const greeting = "hello world"\nexport { greeting }')
  await writeFile(join(tempDir, 'foo.js'), 'function foo() { return 42 }')
  await writeFile(join(tempDir, 'empty.txt'), '')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Basic search
// ---------------------------------------------------------------------------

describe('ripGrep — basic search', () => {
  test('finds matching lines', async () => {
    const ac = new AbortController()
    const results = await ripGrep(['hello', tempDir], tempDir, ac.signal)

    expect(results.length).toBeGreaterThan(0)
    expect(results.some(line => line.includes('hello'))).toBe(true)
  })

  test('returns empty array when no matches', async () => {
    const ac = new AbortController()
    const results = await ripGrep(['zzz_nonexistent_zzz', tempDir], tempDir, ac.signal)

    expect(results).toEqual([])
  })

  test('lists files with --files flag', async () => {
    const ac = new AbortController()
    const results = await ripGrep(['--files'], tempDir, ac.signal)

    expect(results.length).toBe(3)
    expect(results.some(p => p.includes('hello.ts'))).toBe(true)
    expect(results.some(p => p.includes('foo.js'))).toBe(true)
    expect(results.some(p => p.includes('empty.txt'))).toBe(true)
  })

  test('filters with --glob', async () => {
    const ac = new AbortController()
    const results = await ripGrep(['--files', '--glob', '*.ts'], tempDir, ac.signal)

    expect(results.length).toBe(1)
    expect(results[0]).toContain('hello.ts')
  })
})

// ---------------------------------------------------------------------------
// File listing with --files
// ---------------------------------------------------------------------------

describe('ripGrep — file listing', () => {
  test('respects --hidden flag', async () => {
    await writeFile(join(tempDir, '.dotfile'), 'hidden content')
    const ac = new AbortController()
    const results = await ripGrep(['--files', '--hidden'], tempDir, ac.signal)

    expect(results.some(p => p.includes('.dotfile'))).toBe(true)
  })

  test('searches subdirectories', async () => {
    await mkdir(join(tempDir, 'sub'))
    await writeFile(join(tempDir, 'sub', 'deep.ts'), 'deep content')

    const ac = new AbortController()
    const results = await ripGrep(['--files', '--glob', '**/*.ts'], tempDir, ac.signal)

    expect(results.some(p => p.includes('deep.ts'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Abort signal
// ---------------------------------------------------------------------------

describe('ripGrep — abort signal', () => {
  test('rejects when already aborted', async () => {
    const ac = new AbortController()
    ac.abort()

    await expect(
      ripGrep(['--files'], tempDir, ac.signal),
    ).rejects.toThrow(/abort/i)
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('ripGrep — error handling', () => {
  test('throws RipgrepError on invalid regex', async () => {
    const ac = new AbortController()

    await expect(
      ripGrep(['[invalid', tempDir], tempDir, ac.signal),
    ).rejects.toThrow(RipgrepError)
  })

  test('handles pattern starting with dash via -e flag', async () => {
    const ac = new AbortController()
    const results = await ripGrep(['-e', '-hello', tempDir], tempDir, ac.signal)

    // Should not throw — -e prevents misinterpretation
    expect(Array.isArray(results)).toBe(true)
  })
})
