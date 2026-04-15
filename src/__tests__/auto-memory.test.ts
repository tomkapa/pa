import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hasPermissionsToUseTool } from '../services/permissions/pipeline.js'
import { createPermissionContext } from '../services/permissions/context.js'
import { buildTool } from '../services/tools/build-tool.js'
import { makeContext } from '../testing/make-context.js'

describe('auto-memory', () => {
  let tmp: string
  let originalEnv: string | undefined

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pa-auto-memory-'))
    originalEnv = process.env.PA_CONFIG_DIR
    process.env.PA_CONFIG_DIR = tmp
    const { __clearAutoMemoryCacheForTests } = await import('../services/auto-memory/index.js')
    __clearAutoMemoryCacheForTests()
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PA_CONFIG_DIR
    else process.env.PA_CONFIG_DIR = originalEnv
    rmSync(tmp, { recursive: true, force: true })
  })

  describe('getAutoMemoryDir', () => {
    test('returns memory/ subdirectory under the project dir', async () => {
      const { getAutoMemoryDir } = await import('../services/auto-memory/index.js')
      const dir = getAutoMemoryDir('/Users/alice/project')
      expect(dir).toMatch(/\/memory$/)
      expect(dir).toContain('projects')
    })

    test('uses sanitized project path', async () => {
      const { getAutoMemoryDir } = await import('../services/auto-memory/index.js')
      const dir = getAutoMemoryDir('/Users/alice/project')
      // Should not contain raw slashes from the input path
      const lastSegments = dir.split('/projects/')[1]
      expect(lastSegments).toBeDefined()
      // The sanitized segment is between 'projects/' and '/memory'
      const sanitizedPart = lastSegments!.replace('/memory', '')
      expect(sanitizedPart).not.toContain('/')
    })
  })

  describe('ensureAutoMemoryDir', () => {
    test('creates the memory directory if it does not exist', async () => {
      const { ensureAutoMemoryDir, getAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)
      const { existsSync } = await import('node:fs')
      expect(existsSync(dir)).toBe(true)
    })

    test('is idempotent — does not throw if directory already exists', async () => {
      const { ensureAutoMemoryDir, getAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)
      await ensureAutoMemoryDir(dir) // second call should not throw
    })
  })

  describe('isAutoMemoryPath', () => {
    test('returns true for a file inside the memory directory', async () => {
      const { isAutoMemoryPath, getAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const memDir = getAutoMemoryDir('/Users/alice/project')
      expect(isAutoMemoryPath(path.join(memDir, 'user_role.md'), memDir)).toBe(true)
    })

    test('returns true for MEMORY.md inside the memory directory', async () => {
      const { isAutoMemoryPath, getAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const memDir = getAutoMemoryDir('/Users/alice/project')
      expect(isAutoMemoryPath(path.join(memDir, 'MEMORY.md'), memDir)).toBe(true)
    })

    test('returns false for a file outside the memory directory', async () => {
      const { isAutoMemoryPath, getAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const memDir = getAutoMemoryDir('/Users/alice/project')
      expect(isAutoMemoryPath('/Users/alice/project/src/index.ts', memDir)).toBe(false)
    })

    test('rejects path traversal attempts', async () => {
      const { isAutoMemoryPath, getAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const memDir = getAutoMemoryDir('/Users/alice/project')
      expect(isAutoMemoryPath(path.join(memDir, '..', 'session.jsonl'), memDir)).toBe(false)
    })
  })

  describe('parseAutoMemoryFrontmatter', () => {
    test('parses valid frontmatter with all fields', async () => {
      const { parseAutoMemoryFrontmatter } = await import('../services/auto-memory/index.js')
      const markdown = [
        '---',
        'name: Test memory',
        'description: A test memory file',
        'type: feedback',
        '---',
        '',
        'Some content here.',
      ].join('\n')

      const result = parseAutoMemoryFrontmatter(markdown)
      expect(result.frontmatter.name).toBe('Test memory')
      expect(result.frontmatter.description).toBe('A test memory file')
      expect(result.frontmatter.type).toBe('feedback')
      expect(result.content).toContain('Some content here.')
    })

    test('handles missing frontmatter gracefully', async () => {
      const { parseAutoMemoryFrontmatter } = await import('../services/auto-memory/index.js')
      const markdown = 'Just content, no frontmatter.'
      const result = parseAutoMemoryFrontmatter(markdown)
      expect(result.frontmatter.name).toBeUndefined()
      expect(result.frontmatter.type).toBeUndefined()
      expect(result.content).toBe(markdown)
    })

    test('handles malformed YAML gracefully', async () => {
      const { parseAutoMemoryFrontmatter } = await import('../services/auto-memory/index.js')
      const markdown = [
        '---',
        'name: [invalid: yaml: :::',
        '---',
        '',
        'Content after bad frontmatter.',
      ].join('\n')

      const result = parseAutoMemoryFrontmatter(markdown)
      expect(result.frontmatter.name).toBeUndefined()
      expect(result.content).toContain('Content after bad frontmatter.')
    })

    test('validates type field against allowed values', async () => {
      const { parseAutoMemoryFrontmatter } = await import('../services/auto-memory/index.js')
      const markdown = [
        '---',
        'name: Test',
        'type: invalid_type',
        '---',
        '',
        'Content.',
      ].join('\n')

      const result = parseAutoMemoryFrontmatter(markdown)
      // Invalid type should be dropped
      expect(result.frontmatter.type).toBeUndefined()
    })
  })

  describe('scanMemoryFiles', () => {
    test('returns empty array for empty directory', async () => {
      const { scanMemoryFiles, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)
      const headers = await scanMemoryFiles(dir)
      expect(headers).toEqual([])
    })

    test('scans .md files and extracts frontmatter metadata', async () => {
      const { scanMemoryFiles, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      writeFileSync(
        path.join(dir, 'user_role.md'),
        [
          '---',
          'name: User role',
          'description: User is a backend engineer',
          'type: user',
          '---',
          '',
          'User is a backend engineer with 10 years of Go experience.',
        ].join('\n'),
      )

      const headers = await scanMemoryFiles(dir)
      expect(headers).toHaveLength(1)
      expect(headers[0]!.filename).toBe('user_role.md')
      expect(headers[0]!.description).toBe('User is a backend engineer')
      expect(headers[0]!.type).toBe('user')
    })

    test('excludes MEMORY.md from scan results', async () => {
      const { scanMemoryFiles, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      writeFileSync(path.join(dir, 'MEMORY.md'), '- [Test](test.md) — a test memory\n')
      writeFileSync(
        path.join(dir, 'test.md'),
        '---\nname: Test\ntype: user\n---\n\nTest content.',
      )

      const headers = await scanMemoryFiles(dir)
      expect(headers).toHaveLength(1)
      expect(headers[0]!.filename).toBe('test.md')
    })

    test('excludes non-.md files', async () => {
      const { scanMemoryFiles, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      writeFileSync(path.join(dir, 'notes.txt'), 'not a memory file')
      writeFileSync(
        path.join(dir, 'test.md'),
        '---\nname: Test\ntype: user\n---\n\nContent.',
      )

      const headers = await scanMemoryFiles(dir)
      expect(headers).toHaveLength(1)
    })

    test('sorts by mtime descending (newest first)', async () => {
      const { scanMemoryFiles, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      writeFileSync(
        path.join(dir, 'old.md'),
        '---\nname: Old\ntype: user\n---\n\nOld content.',
      )
      // Small delay to ensure different mtime
      const { utimesSync } = await import('node:fs')
      const now = new Date()
      const past = new Date(now.getTime() - 10_000)
      utimesSync(path.join(dir, 'old.md'), past, past)

      writeFileSync(
        path.join(dir, 'new.md'),
        '---\nname: New\ntype: feedback\n---\n\nNew content.',
      )

      const headers = await scanMemoryFiles(dir)
      expect(headers).toHaveLength(2)
      expect(headers[0]!.filename).toBe('new.md')
      expect(headers[1]!.filename).toBe('old.md')
    })

    test('caps at 200 files', async () => {
      const { scanMemoryFiles, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      for (let i = 0; i < 210; i++) {
        writeFileSync(
          path.join(dir, `memory_${String(i).padStart(3, '0')}.md`),
          `---\nname: Memory ${i}\ntype: user\n---\n\nContent ${i}.`,
        )
      }

      const headers = await scanMemoryFiles(dir)
      expect(headers.length).toBeLessThanOrEqual(200)
    })
  })

  describe('buildAutoMemoryPrompt', () => {
    test('returns prompt with MEMORY.md content when index exists', async () => {
      const { buildAutoMemoryPrompt, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      writeFileSync(
        path.join(dir, 'MEMORY.md'),
        '- [User role](user_role.md) — backend engineer with Go expertise\n',
      )

      const prompt = await buildAutoMemoryPrompt(dir)
      expect(prompt).toContain('# auto memory')
      expect(prompt).toContain(dir)
      expect(prompt).toContain('backend engineer with Go expertise')
    })

    test('returns prompt even when MEMORY.md does not exist', async () => {
      const { buildAutoMemoryPrompt, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      const prompt = await buildAutoMemoryPrompt(dir)
      expect(prompt).toContain('# auto memory')
      expect(prompt).toContain(dir)
    })

    test('includes memory type taxonomy in the prompt', async () => {
      const { buildAutoMemoryPrompt, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      const prompt = await buildAutoMemoryPrompt(dir)
      expect(prompt).toContain('## Types of memory')
      expect(prompt).toContain('user')
      expect(prompt).toContain('feedback')
      expect(prompt).toContain('project')
      expect(prompt).toContain('reference')
    })

    test('includes what NOT to save section', async () => {
      const { buildAutoMemoryPrompt, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      const prompt = await buildAutoMemoryPrompt(dir)
      expect(prompt).toContain('## What NOT to save')
    })

    test('includes two-step save protocol', async () => {
      const { buildAutoMemoryPrompt, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      const prompt = await buildAutoMemoryPrompt(dir)
      expect(prompt).toContain('## How to save memories')
      expect(prompt).toContain('MEMORY.md')
    })

    test('includes when to access memories', async () => {
      const { buildAutoMemoryPrompt, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      const prompt = await buildAutoMemoryPrompt(dir)
      expect(prompt).toContain('## When to access memories')
    })

    test('includes staleness caveat', async () => {
      const { buildAutoMemoryPrompt, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      const prompt = await buildAutoMemoryPrompt(dir)
      expect(prompt).toContain('## Before recommending from memory')
    })

    test('appends actual MEMORY.md content at the end', async () => {
      const { buildAutoMemoryPrompt, getAutoMemoryDir, ensureAutoMemoryDir } = await import(
        '../services/auto-memory/index.js'
      )
      const dir = getAutoMemoryDir('/Users/alice/project')
      await ensureAutoMemoryDir(dir)

      writeFileSync(
        path.join(dir, 'MEMORY.md'),
        '- [No mocking DB](feedback_testing.md) — real DB only after prod incident\n',
      )

      const prompt = await buildAutoMemoryPrompt(dir)
      // MEMORY.md content should appear after the instructions
      const memoryContentIndex = prompt.indexOf('No mocking DB')
      const instructionsIndex = prompt.indexOf('## How to save memories')
      expect(memoryContentIndex).toBeGreaterThan(instructionsIndex)
    })
  })

  describe('permission pipeline auto-approve', () => {
    function makeWriteTool() {
      const { z } = require('zod') as typeof import('zod')
      return buildTool<{ file_path: string; content: string }, string>({
        name: 'Write',
        maxResultSizeChars: 10_000,
        inputSchema: z.strictObject({ file_path: z.string(), content: z.string() }),
        async call(input) { return { data: input.content } },
        async prompt() { return 'Write a file.' },
        async description(input) { return `Write ${input.file_path}` },
        mapToolResultToToolResultBlockParam(output, id) {
          return { type: 'tool_result' as const, tool_use_id: id, content: output }
        },
      })
    }

    function makeEditTool() {
      const { z } = require('zod') as typeof import('zod')
      return buildTool<{ file_path: string; old_string: string; new_string: string }, string>({
        name: 'Edit',
        maxResultSizeChars: 10_000,
        inputSchema: z.strictObject({ file_path: z.string(), old_string: z.string(), new_string: z.string() }),
        async call(input) { return { data: input.new_string } },
        async prompt() { return 'Edit a file.' },
        async description(input) { return `Edit ${input.file_path}` },
        mapToolResultToToolResultBlockParam(output, id) {
          return { type: 'tool_result' as const, tool_use_id: id, content: output }
        },
      })
    }

    test('auto-approves Write to a file inside the memory directory', async () => {
      const { getAutoMemoryDir } = await import('../services/auto-memory/index.js')
      const memDir = getAutoMemoryDir(process.cwd())
      const tool = makeWriteTool()
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: path.join(memDir, 'user_role.md'), content: 'test' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('auto-approves Edit to a file inside the memory directory', async () => {
      const { getAutoMemoryDir } = await import('../services/auto-memory/index.js')
      const memDir = getAutoMemoryDir(process.cwd())
      const tool = makeEditTool()
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: path.join(memDir, 'MEMORY.md'), old_string: 'old', new_string: 'new' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('allow')
    })

    test('does NOT auto-approve Write to files outside memory directory', async () => {
      const tool = makeWriteTool()
      const ctx = createPermissionContext()
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: '/Users/alice/project/src/index.ts', content: 'test' },
        ctx,
        makeContext(),
      )
      // Should fall through to default ask
      expect(result.behavior).toBe('ask')
    })

    test('tool-level deny rules still override memory auto-approve', async () => {
      const { getAutoMemoryDir } = await import('../services/auto-memory/index.js')
      const memDir = getAutoMemoryDir(process.cwd())
      const tool = makeWriteTool()
      const memFile = path.join(memDir, 'user_role.md')
      // Tool-level deny (no content filter) blocks ALL writes, including memory.
      const ctx = createPermissionContext({
        alwaysDenyRules: { userSettings: ['Write'] },
      })
      const result = await hasPermissionsToUseTool(
        tool,
        { file_path: memFile, content: 'test' },
        ctx,
        makeContext(),
      )
      expect(result.behavior).toBe('deny')
    })
  })
})
