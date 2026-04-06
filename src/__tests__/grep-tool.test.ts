import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { grepToolDef, type GrepToolInput, type GrepToolOutput } from '../tools/grepTool.js'
import { buildTool, type ToolUseContext } from '../services/tools/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string

function makeContext(): ToolUseContext {
  return {
    abortController: new AbortController(),
    messages: [],
    options: { tools: [], debug: false, verbose: false },
  }
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pa-grep-test-'))
  await writeFile(join(tempDir, 'hello.ts'), 'const msg = "hello world"\nexport { msg }\n// TODO: refactor')
  await writeFile(join(tempDir, 'foo.js'), 'function foo() {\n  return 42\n}\n// TODO: add tests')
  await writeFile(join(tempDir, 'readme.md'), '# Project\nSome documentation\nTODO: update docs')
  await mkdir(join(tempDir, 'src'))
  await writeFile(join(tempDir, 'src', 'app.ts'), 'const app = "main"\n// TODO: initialize')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// files_with_matches mode (default)
// ---------------------------------------------------------------------------

describe('Grep tool — files_with_matches mode', () => {
  test('finds files containing pattern', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call({ pattern: 'TODO', path: tempDir }, makeContext())

    expect(result.data.mode).toBe('files_with_matches')
    expect(result.data.totalLines).toBe(4) // all 4 files have TODO
    expect(result.data.content).toContain('hello.ts')
    expect(result.data.content).toContain('foo.js')
  })

  test('returns empty when no matches', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call({ pattern: 'zzz_nonexistent_zzz', path: tempDir }, makeContext())

    expect(result.data.content).toBe('')
    expect(result.data.totalLines).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// content mode
// ---------------------------------------------------------------------------

describe('Grep tool — content mode', () => {
  test('shows matching lines with file:line format', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'hello', path: tempDir, output_mode: 'content' },
      makeContext(),
    )

    expect(result.data.mode).toBe('content')
    expect(result.data.content).toContain('hello')
    expect(result.data.content).toContain('hello.ts')
  })

  test('supports context lines with -A', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'hello', path: tempDir, output_mode: 'content', '-A': 1 },
      makeContext(),
    )

    // Should include the line after the match
    expect(result.data.content).toContain('hello')
    expect(result.data.totalLines).toBeGreaterThan(1)
  })

  test('supports context lines with -B', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'export', path: tempDir, output_mode: 'content', '-B': 1 },
      makeContext(),
    )

    expect(result.data.content).toContain('export')
    expect(result.data.totalLines).toBeGreaterThan(1)
  })

  test('supports context lines with -C', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'return', path: tempDir, output_mode: 'content', '-C': 1 },
      makeContext(),
    )

    expect(result.data.content).toContain('return')
    expect(result.data.totalLines).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// count mode
// ---------------------------------------------------------------------------

describe('Grep tool — count mode', () => {
  test('returns file:count format', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'TODO', path: tempDir, output_mode: 'count' },
      makeContext(),
    )

    expect(result.data.mode).toBe('count')
    // Each file with a TODO should appear with a count
    expect(result.data.content).toContain(':1')
  })
})

// ---------------------------------------------------------------------------
// File type filtering
// ---------------------------------------------------------------------------

describe('Grep tool — file type filtering', () => {
  test('filters by --type', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'TODO', path: tempDir, type: 'ts' },
      makeContext(),
    )

    expect(result.data.content).toContain('.ts')
    expect(result.data.content).not.toContain('.js')
    expect(result.data.content).not.toContain('.md')
  })

  test('filters by glob pattern', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'TODO', path: tempDir, glob: '*.js' },
      makeContext(),
    )

    expect(result.data.content).toContain('.js')
    expect(result.data.content).not.toContain('.ts')
  })
})

// ---------------------------------------------------------------------------
// Case insensitive
// ---------------------------------------------------------------------------

describe('Grep tool — case insensitive', () => {
  test('matches case-insensitively with -i', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'todo', path: tempDir, '-i': true },
      makeContext(),
    )

    // Should find 'TODO' despite searching for 'todo'
    expect(result.data.totalLines).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('Grep tool — pagination', () => {
  test('respects head_limit', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'TODO', path: tempDir, head_limit: 2 },
      makeContext(),
    )

    const lines = result.data.content.split('\n').filter(l => l.length > 0)
    expect(lines.length).toBeLessThanOrEqual(2)
    expect(result.data.truncated).toBe(true)
  })

  test('respects offset', async () => {
    const tool = buildTool(grepToolDef())

    // Get all results first
    const all = await tool.call(
      { pattern: 'TODO', path: tempDir, head_limit: 0 },
      makeContext(),
    )

    // Then get with offset
    const offset = await tool.call(
      { pattern: 'TODO', path: tempDir, offset: 1, head_limit: 0 },
      makeContext(),
    )

    expect(offset.data.totalLines).toBe(all.data.totalLines)
    const allLines = all.data.content.split('\n').filter(l => l.length > 0)
    const offsetLines = offset.data.content.split('\n').filter(l => l.length > 0)
    expect(offsetLines.length).toBe(allLines.length - 1)
  })

  test('head_limit=0 returns unlimited results', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'TODO', path: tempDir, head_limit: 0 },
      makeContext(),
    )

    expect(result.data.truncated).toBe(false)
    expect(result.data.totalLines).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Pattern edge cases
// ---------------------------------------------------------------------------

describe('Grep tool — pattern edge cases', () => {
  test('handles pattern starting with dash', async () => {
    // Write a file with a line starting with -
    await writeFile(join(tempDir, 'dash.txt'), '-flag option\n--verbose\nnormal')

    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: '-flag', path: tempDir, output_mode: 'content' },
      makeContext(),
    )

    expect(result.data.content).toContain('-flag')
  })

  test('handles regex patterns', async () => {
    const tool = buildTool(grepToolDef())
    const result = await tool.call(
      { pattern: 'function\\s+\\w+', path: tempDir, output_mode: 'content' },
      makeContext(),
    )

    expect(result.data.content).toContain('function foo')
  })
})

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('Grep tool — input validation', () => {
  test('rejects non-existent path', async () => {
    const tool = buildTool(grepToolDef())
    const validation = await tool.validateInput!(
      { pattern: 'test', path: '/nonexistent/path' },
      makeContext(),
    )

    expect(validation.result).toBe(false)
  })

  test('accepts valid directory path', async () => {
    const tool = buildTool(grepToolDef())
    const validation = await tool.validateInput!(
      { pattern: 'test', path: tempDir },
      makeContext(),
    )

    expect(validation.result).toBe(true)
  })

  test('accepts file path (not just directories)', async () => {
    const tool = buildTool(grepToolDef())
    const validation = await tool.validateInput!(
      { pattern: 'test', path: join(tempDir, 'hello.ts') },
      makeContext(),
    )

    expect(validation.result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('Grep tool — schema', () => {
  test('requires pattern field', () => {
    const def = grepToolDef()
    expect(def.inputSchema.safeParse({}).success).toBe(false)
    expect(def.inputSchema.safeParse({ pattern: 'test' }).success).toBe(true)
  })

  test('accepts semantic number coercion', () => {
    const def = grepToolDef()
    const result = def.inputSchema.safeParse({
      pattern: 'test',
      head_limit: '30',
      '-A': '3',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.head_limit).toBe(30)
      expect(result.data['-A']).toBe(3)
    }
  })

  test('accepts semantic boolean coercion', () => {
    const def = grepToolDef()
    const result = def.inputSchema.safeParse({
      pattern: 'test',
      '-i': 'true',
      '-n': 'false',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data['-i']).toBe(true)
      expect(result.data['-n']).toBe(false)
    }
  })

  test('validates output_mode enum', () => {
    const def = grepToolDef()
    expect(def.inputSchema.safeParse({ pattern: 'test', output_mode: 'content' }).success).toBe(true)
    expect(def.inputSchema.safeParse({ pattern: 'test', output_mode: 'files_with_matches' }).success).toBe(true)
    expect(def.inputSchema.safeParse({ pattern: 'test', output_mode: 'count' }).success).toBe(true)
    expect(def.inputSchema.safeParse({ pattern: 'test', output_mode: 'invalid' }).success).toBe(false)
  })

  test('rejects unknown keys', () => {
    const def = grepToolDef()
    expect(def.inputSchema.safeParse({ pattern: 'test', extra: true }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Result serialization
// ---------------------------------------------------------------------------

describe('Grep tool — result serialization', () => {
  test('shows "No matches found" when empty', () => {
    const tool = buildTool(grepToolDef())
    const output: GrepToolOutput = {
      type: 'grep_result',
      content: '',
      mode: 'files_with_matches',
      totalLines: 0,
      truncated: false,
      appliedLimit: 250,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-456')
    expect(block.content).toBe('No matches found')
  })

  test('includes truncation message', () => {
    const tool = buildTool(grepToolDef())
    const output: GrepToolOutput = {
      type: 'grep_result',
      content: 'file1.ts\nfile2.ts',
      mode: 'files_with_matches',
      totalLines: 500,
      truncated: true,
      appliedLimit: 250,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-456')
    expect(typeof block.content === 'string' && block.content.includes('truncated')).toBe(true)
    expect(typeof block.content === 'string' && block.content.includes('500')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('Grep tool — metadata', () => {
  test('is read-only', () => {
    const tool = buildTool(grepToolDef())
    expect(tool.isReadOnly({ pattern: 'test' })).toBe(true)
  })

  test('is concurrency-safe', () => {
    const tool = buildTool(grepToolDef())
    expect(tool.isConcurrencySafe({ pattern: 'test' })).toBe(true)
  })

  test('is named Grep', () => {
    const tool = buildTool(grepToolDef())
    expect(tool.name).toBe('Grep')
  })
})
