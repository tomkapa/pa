import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  readMemoryFile,
  processMemoryFile,
  MAX_INCLUDE_DEPTH,
} from '../services/memory/file-reader.js'

const tempRoot = path.join(import.meta.dir, '.tmp-memory-file-reader')

beforeEach(() => {
  rmSync(tempRoot, { recursive: true, force: true })
  mkdirSync(tempRoot, { recursive: true })
})

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true })
})

function write(filename: string, content: string): string {
  const full = path.join(tempRoot, filename)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return full
}

// ---------------------------------------------------------------------------
// readMemoryFile
// ---------------------------------------------------------------------------

describe('readMemoryFile', () => {
  test('reads a markdown file and returns MemoryFileInfo', async () => {
    const file = write('CLAUDE.md', '# Hello\n')
    const result = await readMemoryFile(file, 'Project')
    expect(result).not.toBeNull()
    expect(result!.path).toBe(file)
    expect(result!.type).toBe('Project')
    expect(result!.content).toBe('# Hello\n')
    expect(result!.globs).toBeUndefined()
    expect(result!.parent).toBeUndefined()
  })

  test('strips frontmatter from content', async () => {
    const file = write('rule.md', '---\npaths: src/*.ts\n---\nbody only\n')
    const result = await readMemoryFile(file, 'Project')
    expect(result!.content).toBe('body only\n')
    expect(result!.globs).toEqual(['src/*.ts'])
  })

  test('returns null when file does not exist', async () => {
    const result = await readMemoryFile(
      path.join(tempRoot, 'missing.md'),
      'Project',
    )
    expect(result).toBeNull()
  })

  test('returns null when path is a directory', async () => {
    const dir = path.join(tempRoot, 'subdir')
    mkdirSync(dir, { recursive: true })
    const result = await readMemoryFile(dir, 'Project')
    expect(result).toBeNull()
  })

  test('returns null for binary file extensions', async () => {
    const file = write('image.png', 'not really binary but extension matters')
    const result = await readMemoryFile(file, 'Project')
    expect(result).toBeNull()
  })

  test('returns null for files without an extension', async () => {
    const file = write('CLAUDE', 'oops, no extension')
    const result = await readMemoryFile(file, 'Project')
    expect(result).toBeNull()
  })

  test('records parent when supplied', async () => {
    const file = write('CLAUDE.md', '# x')
    const parent = '/some/parent.md'
    const result = await readMemoryFile(file, 'Project', parent)
    expect(result!.parent).toBe(parent)
  })

  test('preserves globs from frontmatter list', async () => {
    const file = write(
      'rule.md',
      '---\npaths:\n  - src/*.ts\n  - test/*.ts\n---\nbody',
    )
    const result = await readMemoryFile(file, 'Project')
    expect(result!.globs).toEqual(['src/*.ts', 'test/*.ts'])
  })
})

// ---------------------------------------------------------------------------
// processMemoryFile (recursive @include resolution)
// ---------------------------------------------------------------------------

describe('processMemoryFile', () => {
  test('returns single file when there are no includes', async () => {
    const file = write('CLAUDE.md', '# Hello\n')
    const processed = new Set<string>()
    const result = await processMemoryFile(file, 'Project', processed)
    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe(file)
  })

  test('follows @./relative includes', async () => {
    const child = write('child.md', '# Child\n')
    const parent = write('parent.md', `# Parent\n@./child.md\n`)
    const processed = new Set<string>()
    const result = await processMemoryFile(parent, 'Project', processed)
    expect(result).toHaveLength(2)
    expect(result[0]!.path).toBe(parent)
    expect(result[1]!.path).toBe(child)
    expect(result[1]!.parent).toBe(parent)
    expect(result[1]!.type).toBe('Project')
  })

  test('follows nested includes (parent → child → grandchild)', async () => {
    const grand = write('grand.md', '# Grand\n')
    const child = write('child.md', `# Child\n@./grand.md\n`)
    const parent = write('parent.md', `# Parent\n@./child.md\n`)
    const result = await processMemoryFile(parent, 'Project', new Set<string>())
    expect(result.map(f => f.path)).toEqual([parent, child, grand])
  })

  test('detects circular includes via processedPaths', async () => {
    const a = write('a.md', `# A\n@./b.md\n`)
    const b = write('b.md', `# B\n@./a.md\n`)
    const result = await processMemoryFile(a, 'Project', new Set<string>())
    // a, then b. a is not loaded a second time.
    expect(result.map(f => f.path)).toEqual([a, b])
  })

  test('caps depth at MAX_INCLUDE_DEPTH', async () => {
    // Build a chain longer than MAX_INCLUDE_DEPTH.
    const chainLength = MAX_INCLUDE_DEPTH + 3
    let prev: string | null = null
    const created: string[] = []
    for (let i = chainLength - 1; i >= 0; i--) {
      const body = prev ? `# n${i}\n@./${path.basename(prev)}\n` : `# n${i}\n`
      const file = write(`n${i}.md`, body)
      created.unshift(file)
      prev = file
    }
    const result = await processMemoryFile(created[0]!, 'Project', new Set<string>())
    // We should load at most depth 0..MAX_INCLUDE_DEPTH inclusive = MAX+1 files.
    expect(result.length).toBeLessThanOrEqual(MAX_INCLUDE_DEPTH + 1)
    expect(result.length).toBeGreaterThan(0)
  })

  test('skips includes pointing at missing files without crashing', async () => {
    const parent = write('parent.md', `# P\n@./missing.md\n`)
    const result = await processMemoryFile(parent, 'Project', new Set<string>())
    expect(result.map(f => f.path)).toEqual([parent])
  })

  test('skips @paths inside fenced code blocks', async () => {
    const real = write('real.md', '# real')
    const parent = write(
      'parent.md',
      [
        '# Parent',
        '@./real.md',
        '```',
        '@./should-not-be-loaded.md',
        '```',
      ].join('\n'),
    )
    const result = await processMemoryFile(parent, 'Project', new Set<string>())
    expect(result.map(f => f.path)).toEqual([parent, real])
  })
})

