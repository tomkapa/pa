import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeToolDef, type WriteToolInput } from '../tools/writeTool.js'
import { readToolDef } from '../tools/readTool.js'
import { FileStateCache } from '../utils/fileStateCache.js'
import { buildTool } from '../services/tools/index.js'
import { makeContext } from '../testing/make-context.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string
let fileStateCache: FileStateCache

/** Read a file via the Read tool so it enters the cache */
async function readViaReadTool(filePath: string): Promise<void> {
  const readTool = buildTool(readToolDef(fileStateCache))
  await readTool.call({ file_path: filePath }, makeContext())
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pa-write-test-'))
  fileStateCache = new FileStateCache()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Creating new files
// ---------------------------------------------------------------------------

describe('Write tool — creating new files', () => {
  test('creates a new file at the specified path', async () => {
    const filePath = join(tempDir, 'new-file.ts')
    const content = 'export const hello = "world"\n'

    const tool = buildTool(writeToolDef(fileStateCache))
    const result = await tool.call({ file_path: filePath, content }, makeContext())

    expect(result.data.type).toBe('create')
    expect(result.data.filePath).toBe(filePath)

    const ondisk = await readFile(filePath, 'utf-8')
    expect(ondisk).toBe(content)
  })

  test('creates parent directories if they do not exist', async () => {
    const filePath = join(tempDir, 'deep', 'nested', 'dir', 'file.ts')
    const content = 'nested content'

    const tool = buildTool(writeToolDef(fileStateCache))
    await tool.call({ file_path: filePath, content }, makeContext())

    const ondisk = await readFile(filePath, 'utf-8')
    expect(ondisk).toBe(content)
  })

  test('new file returns empty patch array', async () => {
    const filePath = join(tempDir, 'brand-new.ts')

    const tool = buildTool(writeToolDef(fileStateCache))
    const result = await tool.call({ file_path: filePath, content: 'hello' }, makeContext())

    expect(result.data.structuredPatch.hunks).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Overwriting existing files
// ---------------------------------------------------------------------------

describe('Write tool — overwriting existing files', () => {
  test('overwrites file content after a prior read', async () => {
    const filePath = join(tempDir, 'existing.ts')
    await writeFile(filePath, 'old content')
    await readViaReadTool(filePath)

    const tool = buildTool(writeToolDef(fileStateCache))
    const result = await tool.call({ file_path: filePath, content: 'new content' }, makeContext())

    expect(result.data.type).toBe('update')
    const ondisk = await readFile(filePath, 'utf-8')
    expect(ondisk).toBe('new content')
  })

  test('generates a structured diff patch for updates', async () => {
    const filePath = join(tempDir, 'diff-test.ts')
    await writeFile(filePath, 'line one\nline two\n')
    await readViaReadTool(filePath)

    const tool = buildTool(writeToolDef(fileStateCache))
    const result = await tool.call(
      { file_path: filePath, content: 'line one\nline changed\n' },
      makeContext(),
    )

    expect(result.data.structuredPatch.hunks.length).toBeGreaterThan(0)
  })

  test('updates the file state cache after write', async () => {
    const filePath = join(tempDir, 'cache-update.ts')
    await writeFile(filePath, 'before')
    await readViaReadTool(filePath)

    const tool = buildTool(writeToolDef(fileStateCache))
    await tool.call({ file_path: filePath, content: 'after' }, makeContext())

    const cached = fileStateCache.get(filePath)
    expect(cached).toBeDefined()
    // The cache should reflect the new write's timestamp
    expect(cached!.timestamp).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Validation — prior read required
// ---------------------------------------------------------------------------

describe('Write tool — validation', () => {
  test('rejects write to existing file not in cache', async () => {
    const filePath = join(tempDir, 'not-read.ts')
    await writeFile(filePath, 'original content')

    const tool = buildTool(writeToolDef(fileStateCache))
    const result = await tool.validateInput!(
      { file_path: filePath, content: 'new content' },
      makeContext(),
    )

    expect(result.result).toBe(false)
    expect(result).toHaveProperty('message')
    expect((result as { message: string }).message).toMatch(/not been read/i)
  })

  test('rejects write when file is stale (modified since read)', async () => {
    const filePath = join(tempDir, 'stale.ts')
    await writeFile(filePath, 'original')
    await readViaReadTool(filePath)

    // Simulate external modification and ensure mtime advances past cached timestamp
    await writeFile(filePath, 'externally modified')
    const futureTime = new Date(Date.now() + 2000)
    await utimes(filePath, futureTime, futureTime)

    const tool = buildTool(writeToolDef(fileStateCache))
    const result = await tool.validateInput!(
      { file_path: filePath, content: 'agent write' },
      makeContext(),
    )

    expect(result.result).toBe(false)
    expect((result as { message: string }).message).toMatch(/modified/i)
  })

  test('allows write to new file (no prior read needed)', async () => {
    const filePath = join(tempDir, 'truly-new.ts')

    const tool = buildTool(writeToolDef(fileStateCache))
    const result = await tool.validateInput!(
      { file_path: filePath, content: 'fresh content' },
      makeContext(),
    )

    expect(result.result).toBe(true)
  })

  test('rejects UNC paths', async () => {
    const tool = buildTool(writeToolDef(fileStateCache))
    const result = await tool.validateInput!(
      { file_path: '\\\\server\\share\\file.ts', content: 'x' },
      makeContext(),
    )

    expect(result.result).toBe(false)
  })

  test('rejects null bytes in path', async () => {
    const tool = buildTool(writeToolDef(fileStateCache))

    await expect(
      tool.call({ file_path: '/tmp/evil\0.ts', content: 'x' }, makeContext()),
    ).rejects.toThrow(/null bytes/i)
  })
})

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('Write tool — metadata', () => {
  test('is NOT read-only', () => {
    const tool = buildTool(writeToolDef(fileStateCache))
    expect(tool.isReadOnly({ file_path: '/any', content: '' })).toBe(false)
  })

  test('is NOT concurrency-safe', () => {
    const tool = buildTool(writeToolDef(fileStateCache))
    expect(tool.isConcurrencySafe({ file_path: '/any', content: '' })).toBe(false)
  })

  test('is named Write', () => {
    const tool = buildTool(writeToolDef(fileStateCache))
    expect(tool.name).toBe('Write')
  })

  test('input schema requires file_path and content', () => {
    const def = writeToolDef(fileStateCache)
    const schema = def.inputSchema

    expect(schema.safeParse({ file_path: '/foo.ts', content: 'x' }).success).toBe(true)
    expect(schema.safeParse({ file_path: '/foo.ts' }).success).toBe(false)
    expect(schema.safeParse({ content: 'x' }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })

  test('mapToolResultToToolResultBlockParam formats output', () => {
    const tool = buildTool(writeToolDef(fileStateCache))
    const output = {
      type: 'create' as const,
      filePath: '/tmp/test.ts',
      content: 'hello',
      structuredPatch: { oldFileName: '', newFileName: '', hunks: [], oldHeader: '', newHeader: '' },
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.type).toBe('tool_result')
    expect(block.tool_use_id).toBe('tool-123')
  })
})
