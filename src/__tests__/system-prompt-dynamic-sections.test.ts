import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  computeEnvironmentInfo,
  getEnvironmentInfoSection,
  getLanguageSection,
  getMcpInstructionsSection,
  getMemorySection,
  getOutputStyleSection,
  getSessionGuidanceSection,
  type SkillSummary,
} from '../services/system-prompt/dynamic-sections.js'
import { invalidateMemoryCache } from '../services/memory/loader.js'

// ---------------------------------------------------------------------------
// getSessionGuidanceSection
// ---------------------------------------------------------------------------

describe('getSessionGuidanceSection', () => {
  test('returns null when there is nothing to say', () => {
    expect(getSessionGuidanceSection(new Set(), [])).toBeNull()
  })

  test('mentions Agent tool when enabled', () => {
    const out = getSessionGuidanceSection(new Set(['Agent']), [])
    expect(out!).toContain('Agent tool')
  })

  test('mentions task tracker when TaskCreate is enabled', () => {
    const out = getSessionGuidanceSection(new Set(['TaskCreate']), [])
    expect(out!).toContain('task')
  })

  test('lists available skills', () => {
    const skills: SkillSummary[] = [
      { name: 'commit', description: 'Make a commit' },
      { name: 'review' },
    ]
    const out = getSessionGuidanceSection(new Set(), skills)
    expect(out!).toContain('commit')
    expect(out!).toContain('Make a commit')
    expect(out!).toContain('review')
  })
})

// ---------------------------------------------------------------------------
// getMemorySection
// ---------------------------------------------------------------------------

describe('getMemorySection', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'system-prompt-memory-'))
    invalidateMemoryCache()
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
    invalidateMemoryCache()
  })

  test('returns null when there is no memory', async () => {
    // Use a managed/home/cwd that have no memory files at all
    const isolated = mkdtempSync(path.join(tmpdir(), 'system-prompt-empty-'))
    try {
      const out = await getMemorySection({
        cwd: isolated,
        home: isolated,
        managedRoot: isolated,
      })
      expect(out).toBeNull()
    } finally {
      rmSync(isolated, { recursive: true, force: true })
    }
  })

  test('returns formatted memory when CLAUDE.md is present', async () => {
    const projectDir = path.join(tempRoot, 'proj')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'CLAUDE.md'), '# Hello world\n', 'utf-8')

    const out = await getMemorySection({
      cwd: projectDir,
      home: tempRoot,
      managedRoot: tempRoot,
    })
    expect(out).not.toBeNull()
    expect(out!).toContain('# Memory')
    expect(out!).toContain('Hello world')
  })
})

// ---------------------------------------------------------------------------
// getEnvironmentInfoSection / computeEnvironmentInfo
// ---------------------------------------------------------------------------

describe('getEnvironmentInfoSection', () => {
  test('renders model id and cwd', () => {
    const out = getEnvironmentInfoSection({
      modelId: 'claude-test',
      os: 'linux x64',
      shell: '/bin/bash',
      cwd: '/tmp/project',
    })
    expect(out).toContain('claude-test')
    expect(out).toContain('/tmp/project')
    expect(out).toContain('linux x64')
    expect(out).toContain('/bin/bash')
  })

  test('renders both name and id when name is supplied', () => {
    const out = getEnvironmentInfoSection({
      modelId: 'claude-test-id',
      modelName: 'Claude Test',
      os: 'darwin arm64',
      shell: '/bin/zsh',
      cwd: '/tmp',
    })
    expect(out).toContain('Claude Test')
    expect(out).toContain('claude-test-id')
  })

  test('does NOT include git status', () => {
    const out = getEnvironmentInfoSection({
      modelId: 'claude-test',
      os: 'linux',
      shell: '/bin/bash',
      cwd: '/tmp',
    })
    expect(out.toLowerCase()).not.toContain('git')
  })
})

describe('computeEnvironmentInfo', () => {
  test('reads OS and shell from process', () => {
    const info = computeEnvironmentInfo('claude-x')
    expect(info.modelId).toBe('claude-x')
    expect(info.os).toContain(process.platform)
    expect(info.cwd).toBe(process.cwd())
  })
})

// ---------------------------------------------------------------------------
// getLanguageSection
// ---------------------------------------------------------------------------

describe('getLanguageSection', () => {
  test('returns null when language is undefined', () => {
    expect(getLanguageSection(undefined)).toBeNull()
  })

  test('returns null when language is empty', () => {
    expect(getLanguageSection('  ')).toBeNull()
  })

  test('renders language preference', () => {
    const out = getLanguageSection('French')
    expect(out!).toContain('French')
  })
})

// ---------------------------------------------------------------------------
// getOutputStyleSection
// ---------------------------------------------------------------------------

describe('getOutputStyleSection', () => {
  test('returns null when no config', () => {
    expect(getOutputStyleSection(undefined)).toBeNull()
    expect(getOutputStyleSection('   ')).toBeNull()
  })

  test('renders the config verbatim', () => {
    const out = getOutputStyleSection('Be terse and use bullet points.')
    expect(out!).toContain('Be terse and use bullet points.')
  })
})

// ---------------------------------------------------------------------------
// getMcpInstructionsSection
// ---------------------------------------------------------------------------

describe('getMcpInstructionsSection', () => {
  test('returns null when no clients', () => {
    expect(getMcpInstructionsSection(undefined)).toBeNull()
    expect(getMcpInstructionsSection([])).toBeNull()
  })

  test('returns null when no client provides instructions', () => {
    expect(
      getMcpInstructionsSection([{ name: 'foo' }, { name: 'bar' }]),
    ).toBeNull()
  })

  test('renders one block per client with instructions', () => {
    const out = getMcpInstructionsSection([
      { name: 'github', instructions: 'Use GitHub for code search' },
      { name: 'noop' },
      { name: 'slack', instructions: 'Send messages via slack' },
    ])
    expect(out!).toContain('## github')
    expect(out!).toContain('Use GitHub for code search')
    expect(out!).toContain('## slack')
    expect(out!).not.toContain('## noop')
  })
})
