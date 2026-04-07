import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  buildGitStatus,
  getSystemContext,
  getUserContext,
  resetSystemContextCache,
  resetUserContextCache,
} from '../services/system-prompt/context.js'
import { invalidateMemoryCache } from '../services/memory/loader.js'

let tempRoot: string

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'system-prompt-context-'))
  invalidateMemoryCache()
  resetUserContextCache()
  resetSystemContextCache()
})

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true })
  invalidateMemoryCache()
  resetUserContextCache()
  resetSystemContextCache()
})

// ---------------------------------------------------------------------------
// getUserContext
// ---------------------------------------------------------------------------

describe('getUserContext', () => {
  test('returns currentDate as YYYY-MM-DD', async () => {
    const out = await getUserContext({
      cwd: tempRoot,
      now: new Date(2026, 3, 7), // April 7, 2026
      memoryOptions: { home: tempRoot, managedRoot: tempRoot },
    })
    expect(out.currentDate).toBe('2026-04-07')
  })

  test('claudeMd is undefined when no memory files exist', async () => {
    const out = await getUserContext({
      cwd: tempRoot,
      now: new Date(),
      memoryOptions: { home: tempRoot, managedRoot: tempRoot },
    })
    expect(out.claudeMd).toBeUndefined()
  })

  test('claudeMd is populated when CLAUDE.md exists', async () => {
    const projectDir = path.join(tempRoot, 'proj')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'CLAUDE.md'), '# Test memory\n', 'utf-8')

    const out = await getUserContext({
      cwd: projectDir,
      now: new Date(),
      memoryOptions: { home: tempRoot, managedRoot: tempRoot },
    })
    expect(out.claudeMd).toBeDefined()
    expect(out.claudeMd!).toContain('Test memory')
  })

  test('zero-pads single-digit months and days', async () => {
    const out = await getUserContext({
      cwd: tempRoot,
      now: new Date(2026, 0, 5),
      memoryOptions: { home: tempRoot, managedRoot: tempRoot },
    })
    expect(out.currentDate).toBe('2026-01-05')
  })
})

// ---------------------------------------------------------------------------
// getSystemContext / buildGitStatus
// ---------------------------------------------------------------------------

function initRepo(dir: string): void {
  // Bare-bones init so the helpers can read a real git repo.
  spawnSync('git', ['init', '-q'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  writeFileSync(path.join(dir, 'README.md'), '# repo\n', 'utf-8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir })
}

describe('buildGitStatus', () => {
  test('returns undefined outside a git repo', async () => {
    const result = await buildGitStatus(tempRoot)
    expect(result).toBeUndefined()
  })

  test('returns a snapshot string inside a git repo', async () => {
    initRepo(tempRoot)
    const result = await buildGitStatus(tempRoot)
    expect(result).toBeDefined()
    expect(result!).toContain('Current branch:')
    expect(result!).toContain('Test User')
    expect(result!).toContain('Recent commits:')
    expect(result!).toContain('initial')
  })

  test('reports clean status as (clean)', async () => {
    initRepo(tempRoot)
    const result = await buildGitStatus(tempRoot)
    expect(result!).toContain('(clean)')
  })

  test('reports working tree changes', async () => {
    initRepo(tempRoot)
    writeFileSync(path.join(tempRoot, 'new-file.txt'), 'hello\n', 'utf-8')
    const result = await buildGitStatus(tempRoot)
    expect(result!).toContain('new-file.txt')
  })
})

describe('getSystemContext', () => {
  test('returns gitStatus undefined for non-repo cwd', async () => {
    const out = await getSystemContext({ cwd: tempRoot })
    expect(out.gitStatus).toBeUndefined()
  })

  test('returns gitStatus for repo cwd', async () => {
    initRepo(tempRoot)
    const out = await getSystemContext({ cwd: tempRoot })
    expect(out.gitStatus).toBeDefined()
    expect(out.gitStatus!).toContain('Current branch:')
  })
})
