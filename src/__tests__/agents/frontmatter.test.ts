import { describe, test, expect } from 'bun:test'
import { parseAgentFrontmatter, normalizeToolList } from '../../services/agents/frontmatter.js'

describe('parseAgentFrontmatter', () => {
  test('parses valid frontmatter with name and description', () => {
    const input = [
      '---',
      'name: code-reviewer',
      'description: "Reviews code for bugs"',
      '---',
      '',
      'You are a code review specialist.',
    ].join('\n')

    const { frontmatter, content } = parseAgentFrontmatter(input)
    expect(frontmatter.name).toBe('code-reviewer')
    expect(frontmatter.description).toBe('Reviews code for bugs')
    expect(content).toBe('You are a code review specialist.')
  })

  test('parses tools as YAML list', () => {
    const input = [
      '---',
      'name: reader',
      'description: "Read-only agent"',
      'tools:',
      '  - Read',
      '  - Grep',
      '  - Glob',
      '---',
      '',
      'Prompt body.',
    ].join('\n')

    const { frontmatter } = parseAgentFrontmatter(input)
    expect(frontmatter.tools).toEqual(['Read', 'Grep', 'Glob'])
  })

  test('parses tools as comma-separated string', () => {
    const input = [
      '---',
      'name: reader',
      'description: "Read-only agent"',
      'tools: Read, Grep, Glob',
      '---',
      '',
      'Prompt body.',
    ].join('\n')

    const { frontmatter } = parseAgentFrontmatter(input)
    expect(frontmatter.tools).toBe('Read, Grep, Glob')
  })

  test('parses disallowedTools field', () => {
    const input = [
      '---',
      'name: safe-agent',
      'description: "No bash"',
      'disallowedTools: Bash, Write',
      '---',
      '',
      'Prompt.',
    ].join('\n')

    const { frontmatter } = parseAgentFrontmatter(input)
    expect(frontmatter.disallowedTools).toBe('Bash, Write')
  })

  test('parses model field', () => {
    const input = [
      '---',
      'name: fast-agent',
      'description: "Fast"',
      'model: haiku',
      '---',
      '',
      'Go fast.',
    ].join('\n')

    const { frontmatter } = parseAgentFrontmatter(input)
    expect(frontmatter.model).toBe('haiku')
  })

  test('returns empty frontmatter for file without frontmatter', () => {
    const input = 'Just plain markdown content.'
    const { frontmatter, content } = parseAgentFrontmatter(input)
    expect(frontmatter).toEqual({})
    expect(content).toBe('Just plain markdown content.')
  })

  test('strips leading blank line after frontmatter', () => {
    const input = '---\nname: test\n---\n\nContent here.'
    const { content } = parseAgentFrontmatter(input)
    expect(content).toBe('Content here.')
  })

  test('handles \\r\\n line endings', () => {
    const input = '---\r\nname: test\r\n---\r\n\r\nContent here.'
    const { content } = parseAgentFrontmatter(input)
    expect(content).toBe('Content here.')
  })
})

describe('normalizeToolList', () => {
  test('returns undefined for undefined input', () => {
    expect(normalizeToolList(undefined)).toBeUndefined()
  })

  test('returns undefined for wildcard "*"', () => {
    expect(normalizeToolList('*')).toBeUndefined()
  })

  test('returns empty array for empty string', () => {
    expect(normalizeToolList('')).toEqual([])
  })

  test('splits comma-separated string', () => {
    expect(normalizeToolList('Read, Grep, Glob')).toEqual(['Read', 'Grep', 'Glob'])
  })

  test('trims whitespace from comma-separated items', () => {
    expect(normalizeToolList('  Read ,  Grep  ')).toEqual(['Read', 'Grep'])
  })

  test('handles single tool string', () => {
    expect(normalizeToolList('Read')).toEqual(['Read'])
  })

  test('passes through YAML array', () => {
    expect(normalizeToolList(['Read', 'Grep'])).toEqual(['Read', 'Grep'])
  })

  test('trims items in YAML array', () => {
    expect(normalizeToolList([' Read ', ' Grep '])).toEqual(['Read', 'Grep'])
  })

  test('returns empty array for empty YAML array', () => {
    expect(normalizeToolList([])).toEqual([])
  })

  test('filters blank entries from comma-separated string', () => {
    expect(normalizeToolList('Read,,Grep,')).toEqual(['Read', 'Grep'])
  })
})
