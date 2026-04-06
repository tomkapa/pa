import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { globToolDef, type GlobToolInput, type GlobToolOutput } from '../tools/globTool.js'
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
  tempDir = await mkdtemp(join(tmpdir(), 'pa-glob-test-'))
  await writeFile(join(tempDir, 'index.ts'), 'export {}')
  await writeFile(join(tempDir, 'utils.ts'), 'export function util() {}')
  await writeFile(join(tempDir, 'readme.md'), '# Hello')
  await mkdir(join(tempDir, 'src'))
  await writeFile(join(tempDir, 'src', 'app.ts'), 'const app = true')
  await writeFile(join(tempDir, 'src', 'style.css'), 'body {}')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Basic glob matching
// ---------------------------------------------------------------------------

describe('Glob tool — basic matching', () => {
  test('finds files by glob pattern', async () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ pattern: '**/*.ts', path: tempDir }, makeContext())

    expect(result.data.type).toBe('files')
    expect(result.data.files.length).toBe(3) // index.ts, utils.ts, src/app.ts
    expect(result.data.files.every(f => f.endsWith('.ts'))).toBe(true)
  })

  test('finds files in subdirectories', async () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ pattern: 'src/**/*.ts', path: tempDir }, makeContext())

    expect(result.data.files.length).toBe(1)
    expect(result.data.files[0]).toContain('app.ts')
  })

  test('matches specific file extensions', async () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ pattern: '**/*.css', path: tempDir }, makeContext())

    expect(result.data.files.length).toBe(1)
    expect(result.data.files[0]).toContain('style.css')
  })

  test('returns empty when no files match', async () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ pattern: '**/*.py', path: tempDir }, makeContext())

    expect(result.data.files).toEqual([])
    expect(result.data.truncated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Hidden files
// ---------------------------------------------------------------------------

describe('Glob tool — hidden files', () => {
  test('finds hidden files (dotfiles)', async () => {
    await writeFile(join(tempDir, '.env'), 'SECRET=123')

    const def = globToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ pattern: '**/.env', path: tempDir }, makeContext())

    expect(result.data.files.length).toBe(1)
    expect(result.data.files[0]).toContain('.env')
  })
})

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('Glob tool — input validation', () => {
  test('rejects non-existent path', async () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const validation = await tool.validateInput!(
      { pattern: '**/*.ts', path: '/nonexistent/path' },
      makeContext(),
    )

    expect(validation.result).toBe(false)
  })

  test('rejects file path (not directory)', async () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const validation = await tool.validateInput!(
      { pattern: '**/*.ts', path: join(tempDir, 'index.ts') },
      makeContext(),
    )

    expect(validation.result).toBe(false)
  })

  test('accepts valid directory path', async () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const validation = await tool.validateInput!(
      { pattern: '**/*.ts', path: tempDir },
      makeContext(),
    )

    expect(validation.result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('Glob tool — schema', () => {
  test('requires pattern field', () => {
    const def = globToolDef()
    expect(def.inputSchema.safeParse({}).success).toBe(false)
    expect(def.inputSchema.safeParse({ pattern: '**/*.ts' }).success).toBe(true)
  })

  test('path is optional', () => {
    const def = globToolDef()
    expect(def.inputSchema.safeParse({ pattern: '**/*.ts' }).success).toBe(true)
    expect(def.inputSchema.safeParse({ pattern: '**/*.ts', path: '/foo' }).success).toBe(true)
  })

  test('rejects unknown keys', () => {
    const def = globToolDef()
    expect(def.inputSchema.safeParse({ pattern: '**/*.ts', extra: true }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Result serialization
// ---------------------------------------------------------------------------

describe('Glob tool — result serialization', () => {
  test('formats files as newline-separated paths', () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const output: GlobToolOutput = {
      type: 'files',
      files: ['/a/b/c.ts', '/a/b/d.ts'],
      truncated: false,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.type).toBe('tool_result')
    expect(block.tool_use_id).toBe('tool-123')
  })

  test('shows "No files found" when empty', () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const output: GlobToolOutput = { type: 'files', files: [], truncated: false }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.content).toBe('No files found')
  })

  test('includes truncation warning', () => {
    const def = globToolDef()
    const tool = buildTool(def)
    const output: GlobToolOutput = {
      type: 'files',
      files: ['/a/file.ts'],
      truncated: true,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(typeof block.content === 'string' && block.content.includes('truncated')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('Glob tool — metadata', () => {
  test('is read-only', () => {
    const tool = buildTool(globToolDef())
    expect(tool.isReadOnly({ pattern: '**' })).toBe(true)
  })

  test('is concurrency-safe', () => {
    const tool = buildTool(globToolDef())
    expect(tool.isConcurrencySafe({ pattern: '**' })).toBe(true)
  })

  test('is named Glob', () => {
    const tool = buildTool(globToolDef())
    expect(tool.name).toBe('Glob')
  })
})
