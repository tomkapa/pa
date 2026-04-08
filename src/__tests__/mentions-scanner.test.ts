import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanFiles } from '../services/mentions/scanner.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scan-files-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanFiles', () => {
  test('returns empty array for empty directory', async () => {
    const result = await scanFiles(root, 100)
    expect(result).toEqual([])
  })

  test('finds top-level files', async () => {
    await writeFile(join(root, 'a.ts'), 'content')
    await writeFile(join(root, 'b.md'), 'content')
    const result = await scanFiles(root, 100)
    expect(result.sort()).toEqual(['a.ts', 'b.md'])
  })

  test('recurses into subdirectories', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'nested.ts'), 'x')
    const result = await scanFiles(root, 100)
    expect(result).toContain(join('src', 'nested.ts'))
  })

  test('skips .git directory', async () => {
    await mkdir(join(root, '.git'))
    await writeFile(join(root, '.git', 'config'), 'x')
    await writeFile(join(root, 'keep.ts'), 'x')
    const result = await scanFiles(root, 100)
    expect(result).toEqual(['keep.ts'])
  })

  test('skips node_modules directory', async () => {
    await mkdir(join(root, 'node_modules'))
    await mkdir(join(root, 'node_modules', 'pkg'))
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'x')
    await writeFile(join(root, 'app.ts'), 'x')
    const result = await scanFiles(root, 100)
    expect(result).toEqual(['app.ts'])
  })

  test('respects maxFiles cap', async () => {
    for (let i = 0; i < 10; i++) {
      await writeFile(join(root, `f${i}.txt`), 'x')
    }
    const result = await scanFiles(root, 3)
    expect(result.length).toBe(3)
  })

  test('ignores unreadable directories silently', async () => {
    // Create a fake path that doesn't exist; scanFiles on a bad root should error
    // but if we mix a valid file with a bad scan, nothing crashes. Here we just
    // verify a non-existent root returns []:
    const missing = join(root, 'does-not-exist')
    const result = await scanFiles(missing, 100)
    expect(result).toEqual([])
  })
})
