import { describe, test, expect } from 'bun:test'
import { resolveAgentTools } from '../../services/agents/resolve-tools.js'
import type { BuiltInAgentDefinition } from '../../services/agents/types.js'
import { makeFakeTool } from '../../testing/make-tool-def.js'

function makeAgent(overrides: Partial<BuiltInAgentDefinition> = {}): BuiltInAgentDefinition {
  return {
    agentType: 'test-agent',
    whenToUse: 'Testing',
    getSystemPrompt: () => 'test prompt',
    source: 'built-in',
    ...overrides,
  }
}

const allTools = [
  makeFakeTool('Read'),
  makeFakeTool('Write'),
  makeFakeTool('Edit'),
  makeFakeTool('Bash'),
  makeFakeTool('Grep'),
  makeFakeTool('Glob'),
]

describe('resolveAgentTools', () => {
  test('returns all tools when no allowlist or blocklist', () => {
    const agent = makeAgent()
    const result = resolveAgentTools(agent, allTools)
    expect(result.map(t => t.name)).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'])
  })

  test('filters to allowlist only', () => {
    const agent = makeAgent({ tools: ['Read', 'Grep', 'Glob'] })
    const result = resolveAgentTools(agent, allTools)
    expect(result.map(t => t.name)).toEqual(['Read', 'Grep', 'Glob'])
  })

  test('removes blocklisted tools', () => {
    const agent = makeAgent({ disallowedTools: ['Bash', 'Write'] })
    const result = resolveAgentTools(agent, allTools)
    expect(result.map(t => t.name)).toEqual(['Read', 'Edit', 'Grep', 'Glob'])
  })

  test('applies allowlist first, then blocklist', () => {
    const agent = makeAgent({
      tools: ['Read', 'Grep', 'Bash'],
      disallowedTools: ['Bash'],
    })
    const result = resolveAgentTools(agent, allTools)
    expect(result.map(t => t.name)).toEqual(['Read', 'Grep'])
  })

  test('empty allowlist results in no tools', () => {
    const agent = makeAgent({ tools: [] })
    const result = resolveAgentTools(agent, allTools)
    expect(result).toEqual([])
  })

  test('blocklist for nonexistent tool does not error', () => {
    const agent = makeAgent({ disallowedTools: ['NonExistent'] })
    const result = resolveAgentTools(agent, allTools)
    expect(result).toHaveLength(allTools.length)
  })

  test('tool name matching is case-sensitive', () => {
    const agent = makeAgent({ tools: ['read', 'GREP'] }) // wrong case
    const result = resolveAgentTools(agent, allTools)
    expect(result).toEqual([])
  })

  test('does not mutate the input array', () => {
    const toolsCopy = [...allTools]
    const agent = makeAgent({ tools: ['Read'] })
    resolveAgentTools(agent, allTools)
    expect(allTools).toHaveLength(toolsCopy.length)
  })
})
