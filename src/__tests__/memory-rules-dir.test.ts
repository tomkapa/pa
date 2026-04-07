import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { processRulesDir } from '../services/memory/rules-dir.js'

let tempRoot: string

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'memory-rules-dir-'))
})

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true })
})

function write(rel: string, content: string): string {
  const full = path.join(tempRoot, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return full
}

describe('processRulesDir', () => {
  test('returns empty result when directory does not exist', async () => {
    const result = await processRulesDir(
      path.join(tempRoot, 'nope'),
      'Project',
      new Set<string>(),
    )
    expect(result.unconditional).toEqual([])
    expect(result.conditional).toEqual([])
  })

  test('loads .md files at top level as unconditional', async () => {
    write('rules/a.md', '# A\n')
    write('rules/b.md', '# B\n')
    const result = await processRulesDir(
      path.join(tempRoot, 'rules'),
      'Project',
      new Set<string>(),
    )
    expect(result.unconditional).toHaveLength(2)
    expect(result.conditional).toEqual([])
    expect(
      result.unconditional.map(f => path.basename(f.path)).sort(),
    ).toEqual(['a.md', 'b.md'])
    for (const file of result.unconditional) {
      expect(file.type).toBe('Project')
      expect(file.globs).toBeUndefined()
    }
  })

  test('recurses into subdirectories', async () => {
    write('rules/a.md', '# A\n')
    write('rules/sub/b.md', '# B\n')
    write('rules/sub/deep/c.md', '# C\n')
    const result = await processRulesDir(
      path.join(tempRoot, 'rules'),
      'Project',
      new Set<string>(),
    )
    expect(
      result.unconditional.map(f => path.basename(f.path)).sort(),
    ).toEqual(['a.md', 'b.md', 'c.md'])
  })

  test('partitions files with paths: frontmatter into conditional', async () => {
    write('rules/uncond.md', '# Always\n')
    write('rules/cond.md', '---\npaths: src/*.ts\n---\n# Conditional\n')
    const result = await processRulesDir(
      path.join(tempRoot, 'rules'),
      'Project',
      new Set<string>(),
    )
    expect(result.unconditional).toHaveLength(1)
    expect(path.basename(result.unconditional[0]!.path)).toBe('uncond.md')
    expect(result.conditional).toHaveLength(1)
    expect(path.basename(result.conditional[0]!.path)).toBe('cond.md')
    expect(result.conditional[0]!.globs).toEqual(['src/*.ts'])
  })

  test('skips non-.md files', async () => {
    write('rules/a.md', '# A')
    write('rules/b.txt', 'text')
    write('rules/c.json', '{}')
    const result = await processRulesDir(
      path.join(tempRoot, 'rules'),
      'Project',
      new Set<string>(),
    )
    expect(result.unconditional).toHaveLength(1)
    expect(path.basename(result.unconditional[0]!.path)).toBe('a.md')
  })

  test('returns deterministic ordering across runs (sorted)', async () => {
    write('rules/c.md', '# C')
    write('rules/a.md', '# A')
    write('rules/b.md', '# B')
    const result = await processRulesDir(
      path.join(tempRoot, 'rules'),
      'Project',
      new Set<string>(),
    )
    expect(result.unconditional.map(f => path.basename(f.path))).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ])
  })

  test('detects symlink cycles via realpath', async () => {
    write('rules/a.md', '# A')
    const cycleLink = path.join(tempRoot, 'rules', 'loop')
    symlinkSync(path.join(tempRoot, 'rules'), cycleLink, 'dir')

    const result = await processRulesDir(
      path.join(tempRoot, 'rules'),
      'Project',
      new Set<string>(),
    )
    expect(result.unconditional).toHaveLength(1)
    expect(path.basename(result.unconditional[0]!.path)).toBe('a.md')
  })
})
