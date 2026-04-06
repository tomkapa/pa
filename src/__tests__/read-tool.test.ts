import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readToolDef, type ReadToolInput, type ReadToolOutput } from '../tools/readTool.js'
import { FileStateCache } from '../utils/fileStateCache.js'
import { buildTool } from '../services/tools/index.js'
import { makeContext } from '../testing/make-context.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string
let fileStateCache: FileStateCache

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pa-read-test-'))
  fileStateCache = new FileStateCache()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Basic file reading
// ---------------------------------------------------------------------------

describe('Read tool — basic reading', () => {
  test('reads a text file with line numbers', async () => {
    const filePath = join(tempDir, 'hello.ts')
    await writeFile(filePath, 'import fs from "fs"\n\nexport function main() {}')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    const result = await tool.call({ file_path: filePath }, makeContext())

    expect(result.data.type).toBe('text')
    expect(result.data.content).toContain('1\timport fs from "fs"')
    expect(result.data.content).toContain('2\t')
    expect(result.data.content).toContain('3\texport function main() {}')
    expect(result.data.totalLines).toBe(3)
    expect(result.data.numLines).toBe(3)
    expect(result.data.startLine).toBe(1)
  })

  test('reads single-line file', async () => {
    const filePath = join(tempDir, 'single.txt')
    await writeFile(filePath, 'only line')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    const result = await tool.call({ file_path: filePath }, makeContext())

    expect(result.data.content).toBe('1\tonly line')
    expect(result.data.totalLines).toBe(1)
  })

  test('reads empty file', async () => {
    const filePath = join(tempDir, 'empty.txt')
    await writeFile(filePath, '')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    const result = await tool.call({ file_path: filePath }, makeContext())

    expect(result.data.content).toBe('')
    expect(result.data.totalLines).toBe(0)
    expect(result.data.numLines).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Offset and limit
// ---------------------------------------------------------------------------

describe('Read tool — offset and limit', () => {
  test('offset skips to specified line', async () => {
    const filePath = join(tempDir, 'lines.txt')
    await writeFile(filePath, 'a\nb\nc\nd\ne')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    const result = await tool.call({ file_path: filePath, offset: 3 }, makeContext())

    expect(result.data.startLine).toBe(3)
    expect(result.data.content).toBe('3\tc\n4\td\n5\te')
    expect(result.data.numLines).toBe(3)
    expect(result.data.totalLines).toBe(5)
  })

  test('limit caps number of lines returned', async () => {
    const filePath = join(tempDir, 'lines.txt')
    await writeFile(filePath, 'a\nb\nc\nd\ne')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    const result = await tool.call({ file_path: filePath, limit: 2 }, makeContext())

    expect(result.data.numLines).toBe(2)
    expect(result.data.content).toBe('1\ta\n2\tb')
  })

  test('offset and limit together', async () => {
    const filePath = join(tempDir, 'lines.txt')
    await writeFile(filePath, 'a\nb\nc\nd\ne')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    const result = await tool.call({ file_path: filePath, offset: 2, limit: 2 }, makeContext())

    expect(result.data.startLine).toBe(2)
    expect(result.data.numLines).toBe(2)
    expect(result.data.content).toBe('2\tb\n3\tc')
  })

  test('offset beyond file length returns empty', async () => {
    const filePath = join(tempDir, 'short.txt')
    await writeFile(filePath, 'a\nb')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    const result = await tool.call({ file_path: filePath, offset: 100 }, makeContext())

    expect(result.data.numLines).toBe(0)
    expect(result.data.content).toBe('')
  })
})

// ---------------------------------------------------------------------------
// File state cache integration
// ---------------------------------------------------------------------------

describe('Read tool — file state cache', () => {
  test('caches file state after read', async () => {
    const filePath = join(tempDir, 'cached.ts')
    await writeFile(filePath, 'cached content')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    await tool.call({ file_path: filePath }, makeContext())

    expect(fileStateCache.has(filePath)).toBe(true)
    const state = fileStateCache.get(filePath)
    expect(state).toBeDefined()
    expect(state!.timestamp).toBeGreaterThan(0)
  })

  test('cache stores offset and limit from read', async () => {
    const filePath = join(tempDir, 'partial.ts')
    await writeFile(filePath, 'a\nb\nc\nd')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    await tool.call({ file_path: filePath, offset: 2, limit: 2 }, makeContext())

    const state = fileStateCache.get(filePath)
    expect(state!.offset).toBe(2)
    expect(state!.limit).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('Read tool — errors', () => {
  test('rejects device files', async () => {
    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)

    await expect(
      tool.call({ file_path: '/dev/zero' }, makeContext()),
    ).rejects.toThrow(/device file/i)
  })

  test('rejects binary files by extension', async () => {
    const filePath = join(tempDir, 'binary.exe')
    await writeFile(filePath, 'MZ...')

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)

    await expect(
      tool.call({ file_path: filePath }, makeContext()),
    ).rejects.toThrow(/binary/i)
  })

  test('rejects file not found', async () => {
    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)

    await expect(
      tool.call({ file_path: join(tempDir, 'nonexistent.ts') }, makeContext()),
    ).rejects.toThrow()
  })

  test('rejects binary content (null bytes)', async () => {
    const filePath = join(tempDir, 'sneaky.dat')
    const content = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f, 0x00, 0x00])
    await writeFile(filePath, content)

    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)

    await expect(
      tool.call({ file_path: filePath }, makeContext()),
    ).rejects.toThrow(/binary/i)
  })
})

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('Read tool — metadata', () => {
  test('is read-only', () => {
    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    expect(tool.isReadOnly({ file_path: '/any' })).toBe(true)
  })

  test('is concurrency-safe', () => {
    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    expect(tool.isConcurrencySafe({ file_path: '/any' })).toBe(true)
  })

  test('is named Read', () => {
    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    expect(tool.name).toBe('Read')
  })

  test('input schema validates required file_path', () => {
    const def = readToolDef(fileStateCache)
    const schema = def.inputSchema

    expect(schema.safeParse({ file_path: '/foo.ts' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ file_path: 123 }).success).toBe(false)
  })

  test('input schema accepts optional offset and limit', () => {
    const def = readToolDef(fileStateCache)
    const schema = def.inputSchema

    expect(schema.safeParse({ file_path: '/foo.ts', offset: 5, limit: 10 }).success).toBe(true)
  })

  test('mapToolResultToToolResultBlockParam formats text output', () => {
    const def = readToolDef(fileStateCache)
    const tool = buildTool(def)
    const output: ReadToolOutput = {
      type: 'text',
      content: '1\thello',
      numLines: 1,
      startLine: 1,
      totalLines: 1,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-abc')
    expect(block.type).toBe('tool_result')
    expect(block.tool_use_id).toBe('tool-abc')
  })
})
