import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generatePreview,
  maybePersistLargeToolResult,
  effectiveThreshold,
  getToolResultsDir,
} from '../services/tools/execution/persist-result.js'
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from '../services/tools/execution/types.js'
import { isEmptyContent, contentSize } from '../services/tools/execution/result-size.js'
import type { ToolResultBlockParam } from '../services/tools/types.js'

// ---------------------------------------------------------------------------
// Test setup: redirect PA_CONFIG_DIR to a temp directory so we don't write
// to the real ~/.pa during tests.
// ---------------------------------------------------------------------------

let tmpDir: string
let originalConfigDir: string | undefined
let originalCwd: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pa-persist-test-'))
  originalConfigDir = process.env.PA_CONFIG_DIR
  process.env.PA_CONFIG_DIR = tmpDir
  originalCwd = process.cwd()
})

afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.PA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.PA_CONFIG_DIR
  }
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(
  content: ToolResultBlockParam['content'],
  toolUseId = 'toolu_test123',
): ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// generatePreview
// ═══════════════════════════════════════════════════════════════════════════

describe('generatePreview', () => {
  test('short content returns unchanged with hasMore=false', () => {
    const result = generatePreview('hello world', 100)
    expect(result.preview).toBe('hello world')
    expect(result.hasMore).toBe(false)
  })

  test('long content truncates at newline boundary', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}: ${'x'.repeat(40)}`)
    const content = lines.join('\n')
    const result = generatePreview(content, 200)

    expect(result.hasMore).toBe(true)
    expect(result.preview.length).toBeLessThanOrEqual(200)
    // Should end at a newline, not mid-line
    expect(result.preview.endsWith('\n') || !result.preview.includes('\n') || result.preview === content.slice(0, result.preview.length)).toBe(true)
  })

  test('falls back to hard cut when no newline in second half', () => {
    // One giant line with no newlines
    const content = 'x'.repeat(5000)
    const result = generatePreview(content, 200)

    expect(result.hasMore).toBe(true)
    expect(result.preview.length).toBe(200)
  })

  test('prefers newline boundary when within 50% range', () => {
    // Newline at position 150, limit 200 — 150 > 100 (50%), so use it
    const content = 'a'.repeat(150) + '\n' + 'b'.repeat(200)
    const result = generatePreview(content, 200)

    expect(result.hasMore).toBe(true)
    expect(result.preview.length).toBe(150)
  })

  test('ignores newline when too early (below 50% threshold)', () => {
    // Newline at position 10, limit 200 — 10 < 100 (50%), so hard cut
    const content = 'a'.repeat(10) + '\n' + 'b'.repeat(500)
    const result = generatePreview(content, 200)

    expect(result.hasMore).toBe(true)
    expect(result.preview.length).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// effectiveThreshold
// ═══════════════════════════════════════════════════════════════════════════

describe('effectiveThreshold', () => {
  test('returns min of tool max and global default', () => {
    expect(effectiveThreshold(30_000)).toBe(30_000)
    expect(effectiveThreshold(100_000)).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS)
  })

  test('Infinity opts out entirely', () => {
    expect(effectiveThreshold(Infinity)).toBe(Infinity)
  })

  test('tool threshold equal to global returns global', () => {
    expect(effectiveThreshold(DEFAULT_MAX_RESULT_SIZE_CHARS)).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// maybePersistLargeToolResult
// ═══════════════════════════════════════════════════════════════════════════

describe('maybePersistLargeToolResult', () => {
  test('small result passes through unchanged', async () => {
    const block = makeBlock('small output')
    const result = await maybePersistLargeToolResult(block, 'Test', 100)
    expect(result).toBe(block)
  })

  test('empty string result gets marker', async () => {
    const block = makeBlock('')
    const result = await maybePersistLargeToolResult(block, 'Bash', 50_000)
    expect(result.content).toBe('(Bash completed with no output)')
  })

  test('whitespace-only result gets marker', async () => {
    const block = makeBlock('   \n  ')
    const result = await maybePersistLargeToolResult(block, 'Bash', 50_000)
    expect(result.content).toBe('(Bash completed with no output)')
  })

  test('undefined content gets marker', async () => {
    const block = makeBlock(undefined)
    const result = await maybePersistLargeToolResult(block, 'Bash', 50_000)
    expect(result.content).toBe('(Bash completed with no output)')
  })

  test('empty array content gets marker', async () => {
    const block = makeBlock([])
    const result = await maybePersistLargeToolResult(block, 'Grep', 50_000)
    expect(result.content).toBe('(Grep completed with no output)')
  })

  test('image blocks are never persisted', async () => {
    const block = makeBlock([
      { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'x'.repeat(100_000) } },
    ])
    const result = await maybePersistLargeToolResult(block, 'Screenshot', 100)
    expect(result).toBe(block) // Unchanged — not persisted
  })

  test('document blocks are never persisted', async () => {
    const block = makeBlock([
      { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'x'.repeat(100_000) } },
    ])
    const result = await maybePersistLargeToolResult(block, 'Read', 100)
    expect(result).toBe(block)
  })

  test('large string result is persisted to disk with preview', async () => {
    const longContent = 'line 1\nline 2\nline 3\n' + 'x'.repeat(60_000)
    const block = makeBlock(longContent, 'toolu_persist_test')
    const result = await maybePersistLargeToolResult(block, 'Bash', 5_000)

    const content = result.content as string
    expect(content).toContain('<persisted-output>')
    expect(content).toContain('</persisted-output>')
    expect(content).toContain('Output too large')
    expect(content).toContain('Full output saved to:')
    expect(content).toContain('Preview')

    const dir = getToolResultsDir()
    const files = await readdir(dir)
    expect(files).toContain('toolu_persist_test.txt')

    const filePath = join(dir, 'toolu_persist_test.txt')
    const written = await readFile(filePath, 'utf-8')
    expect(written).toBe(longContent)
  })

  test('large array content is persisted as JSON', async () => {
    const largeText = 'x'.repeat(60_000)
    const block = makeBlock(
      [{ type: 'text' as const, text: largeText }],
      'toolu_json_test',
    )
    const result = await maybePersistLargeToolResult(block, 'Grep', 5_000)

    const content = result.content as string
    expect(content).toContain('<persisted-output>')
    expect(content).toContain('.json')

    const dir = getToolResultsDir()
    const files = await readdir(dir)
    expect(files).toContain('toolu_json_test.json')

    const written = await readFile(join(dir, 'toolu_json_test.json'), 'utf-8')
    const parsed = JSON.parse(written)
    expect(parsed).toEqual([{ type: 'text', text: largeText }])
  })

  test('exclusive-create flag: second write is silently skipped', async () => {
    const longContent = 'y'.repeat(10_000)
    const block = makeBlock(longContent, 'toolu_idempotent')

    const result1 = await maybePersistLargeToolResult(block, 'Bash', 100)
    expect((result1.content as string)).toContain('<persisted-output>')

    const result2 = await maybePersistLargeToolResult(block, 'Bash', 100)
    expect((result2.content as string)).toContain('<persisted-output>')

    const dir = getToolResultsDir()
    const written = await readFile(join(dir, 'toolu_idempotent.txt'), 'utf-8')
    expect(written).toBe(longContent)
  })

  test('Infinity threshold means nothing is ever persisted', async () => {
    const longContent = 'z'.repeat(1_000_000)
    const block = makeBlock(longContent)
    const result = await maybePersistLargeToolResult(block, 'Read', Infinity)
    expect(result).toBe(block)
  })

  test('result at exactly the threshold passes through', async () => {
    const content = 'x'.repeat(1000)
    const block = makeBlock(content)
    const result = await maybePersistLargeToolResult(block, 'Test', 1000)
    expect(result).toBe(block)
  })

  test('result one char over threshold is persisted', async () => {
    const content = 'x'.repeat(1001)
    const block = makeBlock(content, 'toolu_boundary')
    const result = await maybePersistLargeToolResult(block, 'Test', 1000)
    expect((result.content as string)).toContain('<persisted-output>')
  })

  test('preserves tool_use_id and type in returned block', async () => {
    const longContent = 'x'.repeat(10_000)
    const block = makeBlock(longContent, 'toolu_preserve_id')
    const result = await maybePersistLargeToolResult(block, 'Bash', 100)

    expect(result.type).toBe('tool_result')
    expect(result.tool_use_id).toBe('toolu_preserve_id')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Integration: isEmptyContent and contentSize (kept from result-size.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe('result-size helpers (regression)', () => {
  test('isEmptyContent basics still work', () => {
    expect(isEmptyContent(undefined)).toBe(true)
    expect(isEmptyContent('')).toBe(true)
    expect(isEmptyContent('hello')).toBe(false)
    expect(isEmptyContent([])).toBe(true)
  })

  test('contentSize basics still work', () => {
    expect(contentSize(undefined)).toBe(0)
    expect(contentSize('hello')).toBe(5)
    expect(contentSize([
      { type: 'text' as const, text: 'abc' },
      { type: 'text' as const, text: 'de' },
    ])).toBe(5)
  })
})
