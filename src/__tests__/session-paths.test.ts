import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const MODULE_PATH = '../services/session/paths.js'

describe('session paths', () => {
  let tmp: string
  let originalEnv: string | undefined

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pa-session-paths-'))
    originalEnv = process.env.PA_CONFIG_DIR
    process.env.PA_CONFIG_DIR = tmp
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PA_CONFIG_DIR
    else process.env.PA_CONFIG_DIR = originalEnv
    rmSync(tmp, { recursive: true, force: true })
  })

  test('getConfigHomeDir respects PA_CONFIG_DIR', async () => {
    const { getConfigHomeDir } = await import(MODULE_PATH)
    expect(getConfigHomeDir()).toBe(tmp)
  })

  test('getProjectsDir nests under config home', async () => {
    const { getProjectsDir } = await import(MODULE_PATH)
    expect(getProjectsDir()).toBe(path.join(tmp, 'projects'))
  })

  test('sanitizePath replaces slashes and colons with dashes', async () => {
    const { sanitizePath } = await import(MODULE_PATH)
    const sanitized = sanitizePath('/Users/alice/work/project')
    expect(sanitized).not.toContain('/')
    expect(sanitized).not.toContain(':')
    expect(sanitized).toMatch(/^Users-alice-work-project$/)
  })

  test('sanitizePath is stable for the same input', async () => {
    const { sanitizePath } = await import(MODULE_PATH)
    const a = sanitizePath('/Users/alice/work/project')
    const b = sanitizePath('/Users/alice/work/project')
    expect(a).toBe(b)
  })

  test('sanitizePath truncates and hashes very long paths', async () => {
    const { sanitizePath } = await import(MODULE_PATH)
    const longPath = '/Users/' + 'a'.repeat(500)
    const sanitized = sanitizePath(longPath)
    expect(sanitized.length).toBeLessThanOrEqual(120)
    // Two distinct long paths should produce distinct directory names.
    const other = sanitizePath('/Users/' + 'b'.repeat(500))
    expect(other).not.toBe(sanitized)
  })

  test('getSessionFilePath composes project dir and uuid', async () => {
    const { getSessionFilePath, getProjectDir } = await import(MODULE_PATH)
    const cwd = '/tmp/pa-project-xyz'
    const id = '00000000-0000-4000-8000-000000000000'
    const file = getSessionFilePath(cwd, id)
    expect(file).toBe(path.join(getProjectDir(cwd), `${id}.jsonl`))
  })
})
