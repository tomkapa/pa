import { describe, expect, test } from 'bun:test'
import { normalizeName, buildMcpToolName } from '../services/mcp/client.js'
import { withTimeout, TimeoutError } from '../services/mcp/timeout.js'

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

describe('normalizeName', () => {
  test('passes through valid names unchanged', () => {
    expect(normalizeName('my-tool')).toBe('my-tool')
    expect(normalizeName('my_tool')).toBe('my_tool')
    expect(normalizeName('MyTool123')).toBe('MyTool123')
  })

  test('replaces dots with underscores', () => {
    expect(normalizeName('my.tool')).toBe('my_tool')
  })

  test('replaces spaces with underscores', () => {
    expect(normalizeName('my tool')).toBe('my_tool')
  })

  test('replaces slashes with underscores', () => {
    expect(normalizeName('path/to/tool')).toBe('path_to_tool')
  })

  test('replaces special characters', () => {
    expect(normalizeName('tool@v2!')).toBe('tool_v2_')
  })

  test('handles empty string', () => {
    expect(normalizeName('')).toBe('')
  })

  test('preserves hyphens', () => {
    expect(normalizeName('my-tool-name')).toBe('my-tool-name')
  })
})

describe('buildMcpToolName', () => {
  test('builds prefixed name with double underscore separators', () => {
    expect(buildMcpToolName('fs', 'read_file')).toBe('mcp__fs__read_file')
  })

  test('normalizes server and tool names', () => {
    expect(buildMcpToolName('my.server', 'read file')).toBe('mcp__my_server__read_file')
  })

  test('handles already-valid names', () => {
    expect(buildMcpToolName('server', 'tool')).toBe('mcp__server__tool')
  })

  test('truncates to 64 characters', () => {
    const long = 'a'.repeat(60)
    const result = buildMcpToolName(long, long)
    expect(result.length).toBeLessThanOrEqual(64)
    expect(result).toBe(`mcp__${'a'.repeat(60)}__${'a'.repeat(60)}`.slice(0, 64))
  })
})

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe('withTimeout', () => {
  test('resolves when promise completes within timeout', async () => {
    const result = await withTimeout(
      Promise.resolve(42),
      1000,
    )
    expect(result).toBe(42)
  })

  test('rejects with TimeoutError when promise exceeds timeout', async () => {
    const slow = new Promise(resolve => setTimeout(resolve, 5000))
    await expect(
      withTimeout(slow, 50),
    ).rejects.toBeInstanceOf(TimeoutError)
  })

  test('rejects with TimeoutError message containing duration', async () => {
    const slow = new Promise(resolve => setTimeout(resolve, 5000))
    await expect(
      withTimeout(slow, 100),
    ).rejects.toThrow('Timed out after 100ms')
  })

  test('calls onTimeout callback when timeout triggers', async () => {
    let called = false
    const slow = new Promise(resolve => setTimeout(resolve, 5000))
    try {
      await withTimeout(slow, 50, () => { called = true })
    } catch {
      // expected
    }
    expect(called).toBe(true)
  })

  test('propagates rejection from the original promise', async () => {
    const err = new Error('original error')
    await expect(
      withTimeout(Promise.reject(err), 5000),
    ).rejects.toThrow('original error')
  })

  test('does not call onTimeout when promise resolves in time', async () => {
    let called = false
    await withTimeout(
      Promise.resolve('ok'),
      1000,
      () => { called = true },
    )
    expect(called).toBe(false)
  })
})
