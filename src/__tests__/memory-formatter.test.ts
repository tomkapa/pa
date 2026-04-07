import { describe, test, expect } from 'bun:test'
import {
  formatMemoryFile,
  formatMemoryForPrompt,
} from '../services/memory/formatter.js'
import type { MemoryFileInfo } from '../services/memory/types.js'

function file(over: Partial<MemoryFileInfo> = {}): MemoryFileInfo {
  return {
    path: '/abs/CLAUDE.md',
    type: 'Project',
    content: '# Hello\n',
    ...over,
  }
}

describe('formatMemoryFile', () => {
  test('renders project label', () => {
    const out = formatMemoryFile(file({ type: 'Project' }))
    expect(out).toContain('Contents of /abs/CLAUDE.md (project instructions, checked into the codebase):')
    expect(out).toContain('# Hello')
  })

  test('renders local label', () => {
    const out = formatMemoryFile(file({ type: 'Local' }))
    expect(out).toContain("user's private project instructions, not checked in")
  })

  test('renders user label', () => {
    const out = formatMemoryFile(file({ type: 'User' }))
    expect(out).toContain("user's private global instructions for all projects")
  })

  test('renders managed without a label', () => {
    const out = formatMemoryFile(file({ type: 'Managed' }))
    expect(out.startsWith('Contents of /abs/CLAUDE.md:')).toBe(true)
  })

  test('trims trailing whitespace from content', () => {
    const out = formatMemoryFile(file({ content: 'body\n\n\n' }))
    expect(out.endsWith('body')).toBe(true)
  })
})

describe('formatMemoryForPrompt', () => {
  test('returns empty string for empty input', () => {
    expect(formatMemoryForPrompt([])).toBe('')
  })

  test('joins multiple files with the prefix', () => {
    const out = formatMemoryForPrompt([
      file({ path: '/a/CLAUDE.md', content: '# A' }),
      file({ path: '/b/CLAUDE.md', content: '# B' }),
    ])
    expect(out).toContain('IMPORTANT: These instructions OVERRIDE any default behavior')
    expect(out).toContain('Contents of /a/CLAUDE.md')
    expect(out).toContain('Contents of /b/CLAUDE.md')
    expect(out).toContain('# A')
    expect(out).toContain('# B')
  })

  test('files appear in their original order', () => {
    const out = formatMemoryForPrompt([
      file({ path: '/first.md', content: '#1' }),
      file({ path: '/second.md', content: '#2' }),
    ])
    const firstIdx = out.indexOf('/first.md')
    const secondIdx = out.indexOf('/second.md')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(secondIdx).toBeGreaterThan(firstIdx)
  })
})
