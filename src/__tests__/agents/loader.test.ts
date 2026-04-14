import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadCustomAgentDefinitions } from '../../services/agents/loader.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'agents-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function writeAgentFile(name: string, content: string): Promise<void> {
  await writeFile(path.join(tempDir, name), content, 'utf8')
}

describe('loadCustomAgentDefinitions', () => {
  test('loads a valid agent file', async () => {
    await writeAgentFile('code-reviewer.md', [
      '---',
      'name: code-reviewer',
      'description: "Reviews code for bugs"',
      'tools: Read, Grep, Glob',
      '---',
      '',
      'You are a code review specialist.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(1)
    expect(agents[0]!.agentType).toBe('code-reviewer')
    expect(agents[0]!.whenToUse).toBe('Reviews code for bugs')
    expect(agents[0]!.tools).toEqual(['Read', 'Grep', 'Glob'])
    expect(agents[0]!.source).toBe('project')
    expect(agents[0]!.filename).toBe('code-reviewer')
    expect(agents[0]!.getSystemPrompt()).toBe('You are a code review specialist.')
  })

  test('loads multiple agent files', async () => {
    await writeAgentFile('reader.md', [
      '---',
      'name: reader',
      'description: "Read-only agent"',
      'tools: Read, Grep',
      '---',
      '',
      'Read only.',
    ].join('\n'))
    await writeAgentFile('writer.md', [
      '---',
      'name: writer',
      'description: "Writing agent"',
      '---',
      '',
      'Write stuff.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(2)
    const names = agents.map(a => a.agentType).sort()
    expect(names).toEqual(['reader', 'writer'])
  })

  test('skips files without name frontmatter', async () => {
    await writeAgentFile('readme.md', [
      '---',
      'description: "Not an agent, just docs"',
      '---',
      '',
      'This is documentation.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(0)
  })

  test('skips files without description frontmatter', async () => {
    await writeAgentFile('broken.md', [
      '---',
      'name: broken',
      '---',
      '',
      'No description.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(0)
  })

  test('skips files with invalid agent names', async () => {
    await writeAgentFile('bad.md', [
      '---',
      'name: ab',
      'description: "Too short"',
      '---',
      '',
      'Nope.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(0)
  })

  test('skips non-.md files', async () => {
    await writeAgentFile('agent.txt', [
      '---',
      'name: text-agent',
      'description: "Text file"',
      '---',
      '',
      'Not markdown.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(0)
  })

  test('returns empty array for nonexistent directory', async () => {
    const agents = await loadCustomAgentDefinitions('/nonexistent/path/agents')
    expect(agents).toEqual([])
  })

  test('parses model field', async () => {
    await writeAgentFile('fast.md', [
      '---',
      'name: fast-agent',
      'description: "A fast agent"',
      'model: haiku',
      '---',
      '',
      'Be fast.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(1)
    expect(agents[0]!.model).toBe('haiku')
  })

  test('parses disallowedTools field', async () => {
    await writeAgentFile('safe.md', [
      '---',
      'name: safe-agent',
      'description: "No bash"',
      'disallowedTools: Bash',
      '---',
      '',
      'Be safe.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(1)
    expect(agents[0]!.disallowedTools).toEqual(['Bash'])
  })

  test('tools is undefined when not specified (all tools)', async () => {
    await writeAgentFile('general.md', [
      '---',
      'name: general-agent',
      'description: "General purpose"',
      '---',
      '',
      'Do anything.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(1)
    expect(agents[0]!.tools).toBeUndefined()
  })

  test('tools with wildcard "*" is undefined (all tools)', async () => {
    await writeAgentFile('wildcard.md', [
      '---',
      'name: wildcard-agent',
      'description: "All tools via wildcard"',
      'tools: "*"',
      '---',
      '',
      'Everything.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(1)
    expect(agents[0]!.tools).toBeUndefined()
  })

  test('skips directories inside the agents dir', async () => {
    await mkdir(path.join(tempDir, 'subdir'))
    await writeFile(
      path.join(tempDir, 'subdir', 'nested.md'),
      '---\nname: nested\ndescription: "Nested"\n---\n\nNested.',
      'utf8',
    )

    const agents = await loadCustomAgentDefinitions(tempDir)
    // Only top-level files — non-recursive
    expect(agents).toHaveLength(0)
  })

  test('handles file without frontmatter', async () => {
    await writeAgentFile('plain.md', 'Just plain markdown.')

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(0)
  })

  test('model is undefined when empty string', async () => {
    await writeAgentFile('no-model.md', [
      '---',
      'name: no-model-agent',
      'description: "No model override"',
      'model: ""',
      '---',
      '',
      'Default model.',
    ].join('\n'))

    const agents = await loadCustomAgentDefinitions(tempDir)
    expect(agents).toHaveLength(1)
    expect(agents[0]!.model).toBeUndefined()
  })
})
