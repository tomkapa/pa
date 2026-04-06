import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bashToolDef, resetCwd, type BashToolInput, type BashToolOutput } from '../tools/bashTool.js'
import { buildTool } from '../services/tools/index.js'
import { makeContext } from '../testing/make-context.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pa-bash-test-'))
  resetCwd()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Basic command execution
// ---------------------------------------------------------------------------

describe('Bash tool — basic execution', () => {
  test('runs a simple echo command', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ command: 'echo hello' }, makeContext())

    expect(result.data.stdout.trim()).toBe('hello')
    expect(result.data.exitCode).toBe(0)
    expect(result.data.interrupted).toBe(false)
  })

  test('captures stderr', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ command: 'echo error >&2' }, makeContext())

    expect(result.data.stderr.trim()).toBe('error')
    expect(result.data.exitCode).toBe(0)
  })

  test('captures both stdout and stderr', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call(
      { command: 'echo out && echo err >&2' },
      makeContext(),
    )

    expect(result.data.stdout.trim()).toBe('out')
    expect(result.data.stderr.trim()).toBe('err')
  })

  test('returns non-zero exit code on failure', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ command: 'exit 42' }, makeContext())

    expect(result.data.exitCode).toBe(42)
  })

  test('handles multiline output', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call(
      { command: 'echo "line1\nline2\nline3"' },
      makeContext(),
    )

    const lines = result.data.stdout.trim().split('\n')
    expect(lines).toEqual(['line1', 'line2', 'line3'])
  })

  test('handles empty command output', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ command: 'true' }, makeContext())

    expect(result.data.stdout).toBe('')
    expect(result.data.exitCode).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Working directory tracking
// ---------------------------------------------------------------------------

describe('Bash tool — working directory', () => {
  test('tracks cd across commands', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const ctx = makeContext()

    // First command: cd to tempDir
    await tool.call({ command: `cd ${tempDir}` }, ctx)

    // Second command: pwd should reflect the change
    const result = await tool.call({ command: 'pwd -P' }, ctx)

    // Resolve symlinks (macOS /tmp → /private/tmp)
    const { realpathSync } = await import('node:fs')
    const realTempDir = realpathSync(tempDir)
    expect(result.data.stdout.trim()).toBe(realTempDir)
  })

  test('cwd does not update on failed command', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const ctx = makeContext()

    // Get current cwd
    const before = await tool.call({ command: 'pwd -P' }, ctx)
    const cwdBefore = before.data.stdout.trim()

    // Run a command that fails — cd to nonexistent dir
    await tool.call({ command: 'cd /nonexistent_dir_xyz' }, ctx)

    // cwd should be unchanged
    const after = await tool.call({ command: 'pwd -P' }, ctx)
    expect(after.data.stdout.trim()).toBe(cwdBefore)
  })
})

// ---------------------------------------------------------------------------
// Timeout handling
// ---------------------------------------------------------------------------

describe('Bash tool — timeout', () => {
  test('kills command that exceeds timeout', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call(
      { command: 'sleep 60', timeout: 500 },
      makeContext(),
    )

    // Process should have been killed — exit code is non-zero
    expect(result.data.exitCode).not.toBe(0)
    expect(result.data.interrupted).toBe(true)
  })

  test('fast command completes before timeout', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call(
      { command: 'echo fast', timeout: 5000 },
      makeContext(),
    )

    expect(result.data.stdout.trim()).toBe('fast')
    expect(result.data.exitCode).toBe(0)
    expect(result.data.interrupted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Abort (Ctrl+C) support
// ---------------------------------------------------------------------------

describe('Bash tool — abort', () => {
  test('kills command on abort signal', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const abortController = new AbortController()
    const ctx = makeContext({ abortController })

    // Start a long-running command
    const resultPromise = tool.call({ command: 'sleep 60' }, ctx)

    // Abort after a short delay
    setTimeout(() => abortController.abort(), 200)

    const result = await resultPromise
    expect(result.data.interrupted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

describe('Bash tool — environment', () => {
  test('sets GIT_EDITOR=true', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ command: 'echo $GIT_EDITOR' }, makeContext())

    expect(result.data.stdout.trim()).toBe('true')
  })

  test('sets PA_AGENT=1', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ command: 'echo $PA_AGENT' }, makeContext())

    expect(result.data.stdout.trim()).toBe('1')
  })

  test('inherits existing environment variables', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call({ command: 'echo $HOME' }, makeContext())

    expect(result.data.stdout.trim()).toBe(process.env.HOME ?? '')
  })
})

// ---------------------------------------------------------------------------
// File system interaction
// ---------------------------------------------------------------------------

describe('Bash tool — file operations', () => {
  test('can create and read files', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const filePath = join(tempDir, 'test.txt')

    await tool.call({ command: `echo "hello world" > ${filePath}` }, makeContext())
    const content = await readFile(filePath, 'utf-8')

    expect(content.trim()).toBe('hello world')
  })

  test('can list directory contents', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)

    await writeFile(join(tempDir, 'a.txt'), 'a')
    await writeFile(join(tempDir, 'b.txt'), 'b')

    const result = await tool.call({ command: `ls ${tempDir}` }, makeContext())
    expect(result.data.stdout).toContain('a.txt')
    expect(result.data.stdout).toContain('b.txt')
  })
})

// ---------------------------------------------------------------------------
// Piped / compound commands
// ---------------------------------------------------------------------------

describe('Bash tool — compound commands', () => {
  test('handles piped commands', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call(
      { command: 'echo "foo bar baz" | wc -w' },
      makeContext(),
    )

    expect(result.data.stdout.trim()).toBe('3')
  })

  test('handles && chained commands', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call(
      { command: 'echo first && echo second' },
      makeContext(),
    )

    expect(result.data.stdout.trim()).toBe('first\nsecond')
  })

  test('handles || fallback commands', async () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const result = await tool.call(
      { command: 'false || echo fallback' },
      makeContext(),
    )

    expect(result.data.stdout.trim()).toBe('fallback')
    expect(result.data.exitCode).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('Bash tool — metadata', () => {
  test('is not read-only', () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    expect(tool.isReadOnly({ command: 'ls' })).toBe(false)
  })

  test('is not concurrency-safe', () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    expect(tool.isConcurrencySafe({ command: 'ls' })).toBe(false)
  })

  test('is named Bash', () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    expect(tool.name).toBe('Bash')
  })

  test('input schema validates required command', () => {
    const def = bashToolDef()
    const schema = def.inputSchema

    expect(schema.safeParse({ command: 'ls' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ command: 123 }).success).toBe(false)
  })

  test('input schema accepts optional timeout and description', () => {
    const def = bashToolDef()
    const schema = def.inputSchema

    expect(schema.safeParse({ command: 'ls', timeout: 5000, description: 'list files' }).success).toBe(true)
  })

  test('input schema coerces string timeout to number', () => {
    const def = bashToolDef()
    const schema = def.inputSchema

    const result = schema.safeParse({ command: 'ls', timeout: '5000' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timeout).toBe(5000)
    }
  })

  test('input schema rejects unknown fields', () => {
    const def = bashToolDef()
    const schema = def.inputSchema

    expect(schema.safeParse({ command: 'ls', unknown: true }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Result serialization
// ---------------------------------------------------------------------------

describe('Bash tool — mapToolResultToToolResultBlockParam', () => {
  test('formats successful output', () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const output: BashToolOutput = {
      stdout: 'hello world\n',
      stderr: '',
      exitCode: 0,
      interrupted: false,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.type).toBe('tool_result')
    expect(block.tool_use_id).toBe('tool-123')
    expect(typeof block.content).toBe('string')
    expect(block.content as string).toContain('hello world')
  })

  test('includes stderr in output when present', () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const output: BashToolOutput = {
      stdout: '',
      stderr: 'some warning\n',
      exitCode: 0,
      interrupted: false,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.content as string).toContain('some warning')
  })

  test('includes exit code for non-zero exits', () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const output: BashToolOutput = {
      stdout: '',
      stderr: 'command not found\n',
      exitCode: 127,
      interrupted: false,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.content as string).toContain('127')
  })

  test('indicates when command was interrupted', () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const output: BashToolOutput = {
      stdout: '',
      stderr: '',
      exitCode: 137,
      interrupted: true,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.content as string).toMatch(/interrupt|timeout|kill/i)
  })

  test('shows empty output message when no output', () => {
    const def = bashToolDef()
    const tool = buildTool(def)
    const output: BashToolOutput = {
      stdout: '',
      stderr: '',
      exitCode: 0,
      interrupted: false,
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.content).toBeDefined()
  })
})
