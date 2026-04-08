import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileWithTruncation } from '../services/mentions/reader.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readFileWithTruncation', () => {
  test('returns line-numbered content when under line limit', async () => {
    const path = join(root, 'small.txt')
    await writeFile(path, 'one\ntwo\nthree')
    const result = await readFileWithTruncation(path, { maxLines: 100 })
    expect(result.text).toBe('1\tone\n2\ttwo\n3\tthree')
    expect(result.numLines).toBe(3)
    expect(result.totalLines).toBe(3)
    expect(result.truncated).toBe(false)
  })

  test('truncates when content exceeds line limit', async () => {
    const path = join(root, 'big.txt')
    const lines = Array.from({ length: 50 }, (_, i) => `line${i}`)
    await writeFile(path, lines.join('\n'))
    const result = await readFileWithTruncation(path, { maxLines: 10 })
    expect(result.truncated).toBe(true)
    expect(result.numLines).toBe(10)
    expect(result.totalLines).toBe(50)
    const outLines = result.text.split('\n')
    expect(outLines.length).toBe(10)
    expect(outLines[0]).toBe('1\tline0')
    expect(outLines[9]).toBe('10\tline9')
  })

  test('handles empty file', async () => {
    const path = join(root, 'empty.txt')
    await writeFile(path, '')
    const result = await readFileWithTruncation(path, { maxLines: 100 })
    expect(result.text).toBe('')
    expect(result.numLines).toBe(0)
    expect(result.totalLines).toBe(0)
    expect(result.truncated).toBe(false)
  })

  test('exactly at line limit is not truncated', async () => {
    const path = join(root, 'exact.txt')
    await writeFile(path, 'a\nb\nc')
    const result = await readFileWithTruncation(path, { maxLines: 3 })
    expect(result.truncated).toBe(false)
    expect(result.numLines).toBe(3)
    expect(result.totalLines).toBe(3)
  })

  test('drops trailing empty line from a final newline', async () => {
    const path = join(root, 'trailing.txt')
    await writeFile(path, 'one\ntwo\n')
    const result = await readFileWithTruncation(path, { maxLines: 100 })
    expect(result.totalLines).toBe(2)
    expect(result.text).toBe('1\tone\n2\ttwo')
  })

  test('throws for missing file', async () => {
    const path = join(root, 'missing.txt')
    await expect(readFileWithTruncation(path, { maxLines: 100 })).rejects.toThrow()
  })
})
