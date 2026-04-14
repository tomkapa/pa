import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { AgentRegistry, createAgentRegistry } from '../../services/agents/registry.js'
import type { BuiltInAgentDefinition, CustomAgentDefinition } from '../../services/agents/types.js'

function makeBuiltIn(overrides: Partial<BuiltInAgentDefinition> = {}): BuiltInAgentDefinition {
  return {
    agentType: 'built-in-agent',
    whenToUse: 'Built-in testing',
    getSystemPrompt: () => 'built-in prompt',
    source: 'built-in',
    ...overrides,
  }
}

function makeCustom(overrides: Partial<CustomAgentDefinition> = {}): CustomAgentDefinition {
  return {
    agentType: 'custom-agent',
    whenToUse: 'Custom testing',
    getSystemPrompt: () => 'custom prompt',
    source: 'project',
    filename: 'custom-agent',
    ...overrides,
  }
}

describe('AgentRegistry', () => {
  test('registers and finds agents', () => {
    const registry = new AgentRegistry()
    const agent = makeBuiltIn()
    registry.register(agent)
    expect(registry.findAgent('built-in-agent')).toBe(agent)
  })

  test('lookup is case-insensitive', () => {
    const registry = new AgentRegistry()
    registry.register(makeBuiltIn({ agentType: 'Explore' }))
    expect(registry.findAgent('explore')).toBeDefined()
    expect(registry.findAgent('EXPLORE')).toBeDefined()
    expect(registry.findAgent('Explore')).toBeDefined()
  })

  test('returns undefined for unknown agent type', () => {
    const registry = new AgentRegistry()
    expect(registry.findAgent('nonexistent')).toBeUndefined()
  })

  test('registerBuiltIns adds multiple agents', () => {
    const registry = new AgentRegistry()
    registry.registerBuiltIns([
      makeBuiltIn({ agentType: 'agent-a' }),
      makeBuiltIn({ agentType: 'agent-b' }),
    ])
    expect(registry.size).toBe(2)
    expect(registry.findAgent('agent-a')).toBeDefined()
    expect(registry.findAgent('agent-b')).toBeDefined()
  })

  test('custom agents override built-in agents with same name', () => {
    const registry = new AgentRegistry()
    const builtIn = makeBuiltIn({ agentType: 'Explore' })
    const custom = makeCustom({ agentType: 'Explore' })

    registry.registerBuiltIns([builtIn])
    registry.registerCustom([custom])

    const found = registry.findAgent('Explore')
    expect(found?.source).toBe('project')
    expect(found?.getSystemPrompt()).toBe('custom prompt')
  })

  test('custom override is case-insensitive', () => {
    const registry = new AgentRegistry()
    registry.registerBuiltIns([makeBuiltIn({ agentType: 'Explore' })])
    registry.registerCustom([makeCustom({ agentType: 'explore' })])

    // Only one entry — the custom overrode the built-in
    expect(registry.size).toBe(1)
    expect(registry.findAgent('Explore')?.source).toBe('project')
  })

  test('getAllAgents returns all registered agents', () => {
    const registry = new AgentRegistry()
    registry.registerBuiltIns([
      makeBuiltIn({ agentType: 'agent-a' }),
      makeBuiltIn({ agentType: 'agent-b' }),
    ])
    const all = registry.getAllAgents()
    expect(all).toHaveLength(2)
  })
})

describe('createAgentRegistry', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'registry-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('loads built-ins and custom agents', async () => {
    await writeFile(
      path.join(tempDir, 'my-agent.md'),
      '---\nname: my-agent\ndescription: "My agent"\n---\n\nDo things.',
      'utf8',
    )

    const registry = await createAgentRegistry(
      [makeBuiltIn({ agentType: 'built-in' })],
      tempDir,
    )

    expect(registry.findAgent('built-in')).toBeDefined()
    expect(registry.findAgent('my-agent')).toBeDefined()
    expect(registry.size).toBe(2)
  })

  test('custom overrides built-in with same name', async () => {
    await writeFile(
      path.join(tempDir, 'built-in-agent.md'),
      '---\nname: built-in-agent\ndescription: "Override"\n---\n\nCustom override.',
      'utf8',
    )

    const registry = await createAgentRegistry(
      [makeBuiltIn({ agentType: 'built-in-agent' })],
      tempDir,
    )

    expect(registry.size).toBe(1)
    expect(registry.findAgent('built-in-agent')?.source).toBe('project')
  })

  test('handles nonexistent agents directory', async () => {
    const registry = await createAgentRegistry(
      [makeBuiltIn()],
      '/nonexistent/agents',
    )
    expect(registry.size).toBe(1)
  })
})
