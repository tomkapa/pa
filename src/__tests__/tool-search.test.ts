import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  buildTool,
  type Tool,
  type ToolDef,
  type ToolUseContext,
} from '../services/tools/index.js'
import { toolSearchToolDef, type ToolSearchOutput } from '../tools/toolSearchTool.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolStub(
  overrides: Partial<ToolDef<unknown, unknown>> & { name: string },
): Tool<unknown, unknown> {
  return buildTool({
    maxResultSizeChars: 10_000,
    get inputSchema() {
      return z.strictObject({
        value: z.string().optional(),
      })
    },
    async call() { return { data: null } },
    async prompt() { return `Description for ${overrides.name}` },
    async description() { return overrides.name },
    mapToolResultToToolResultBlockParam(_output, toolUseID) {
      return { type: 'tool_result' as const, tool_use_id: toolUseID, content: '' }
    },
    ...overrides,
  })
}

function makeContext(tools: Tool<unknown, unknown>[]): ToolUseContext {
  return {
    abortController: new AbortController(),
    messages: [],
    options: { tools, debug: false, verbose: false },
  }
}

function makeToolSearchTool() {
  return buildTool(toolSearchToolDef())
}

// ---------------------------------------------------------------------------
// ToolSearch tool definition
// ---------------------------------------------------------------------------

describe('ToolSearchTool', () => {
  test('has correct name and safety metadata', () => {
    const tool = makeToolSearchTool()
    expect(tool.name).toBe('ToolSearch')
    expect(tool.isReadOnly({ query: '', max_results: 5 })).toBe(true)
    expect(tool.isConcurrencySafe({ query: '', max_results: 5 })).toBe(true)
    expect(tool.shouldDefer).toBe(false)
  })

  test('input schema accepts valid inputs', () => {
    const tool = makeToolSearchTool()
    const result = tool.inputSchema.safeParse({ query: 'slack' })
    expect(result.success).toBe(true)
  })

  test('input schema applies default max_results', () => {
    const tool = makeToolSearchTool()
    const result = tool.inputSchema.safeParse({ query: 'test' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.max_results).toBe(5)
    }
  })

  test('input schema coerces string max_results via semanticNumber', () => {
    const tool = makeToolSearchTool()
    const result = tool.inputSchema.safeParse({ query: 'test', max_results: '3' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.max_results).toBe(3)
    }
  })
})

// ---------------------------------------------------------------------------
// Direct select mode
// ---------------------------------------------------------------------------

describe('ToolSearch: direct select', () => {
  test('select:Name returns exact match from all tools', async () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
      makeToolStub({ name: 'mcp__slack', isMcp: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:WebFetch', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(1)
    expect(result.data.resolvedMatches[0]!.tool.name).toBe('WebFetch')
    expect(result.data.resolvedMatches[0]!.description).toBe('Description for WebFetch')
  })

  test('select:A,B returns multiple matches', async () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
      makeToolStub({ name: 'WebSearch', shouldDefer: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:WebFetch,WebSearch', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(2)
    const names = result.data.resolvedMatches.map(m => m.tool.name)
    expect(names).toContain('WebFetch')
    expect(names).toContain('WebSearch')
  })

  test('select mode is case-insensitive', async () => {
    const tools = [
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:webfetch', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(1)
    expect(result.data.resolvedMatches[0]!.tool.name).toBe('WebFetch')
  })

  test('select for non-existent tool returns empty', async () => {
    const tools = [makeToolStub({ name: 'Read' })]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:NonExistent', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(0)
  })

  test('select can find non-deferred tools too', async () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'Write' }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:Read', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(1)
    expect(result.data.resolvedMatches[0]!.tool.name).toBe('Read')
  })
})

// ---------------------------------------------------------------------------
// Keyword search mode
// ---------------------------------------------------------------------------

describe('ToolSearch: keyword search', () => {
  test('exact name match returns single result', async () => {
    const tools = [
      makeToolStub({ name: 'mcp__slack__send', isMcp: true }),
      makeToolStub({ name: 'mcp__slack__list', isMcp: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'mcp__slack__send', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(1)
    expect(result.data.resolvedMatches[0]!.tool.name).toBe('mcp__slack__send')
  })

  test('MCP prefix match returns all matching tools', async () => {
    const tools = [
      makeToolStub({ name: 'mcp__slack__send', isMcp: true }),
      makeToolStub({ name: 'mcp__slack__list', isMcp: true }),
      makeToolStub({ name: 'mcp__github__pr', isMcp: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'mcp__slack', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(2)
    const names = result.data.resolvedMatches.map(m => m.tool.name)
    expect(names).toContain('mcp__slack__send')
    expect(names).toContain('mcp__slack__list')
  })

  test('keyword search matches name parts', async () => {
    const tools = [
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
      makeToolStub({ name: 'WebSearch', shouldDefer: true }),
      makeToolStub({ name: 'TaskCreate', shouldDefer: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'web', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches.length).toBeGreaterThanOrEqual(2)
    const names = result.data.resolvedMatches.map(m => m.tool.name)
    expect(names).toContain('WebFetch')
    expect(names).toContain('WebSearch')
  })

  test('keyword search only searches deferred tools', async () => {
    const tools = [
      makeToolStub({ name: 'Read' }), // NOT deferred
      makeToolStub({ name: 'ReadMcp', isMcp: true }), // deferred
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'read', max_results: 5 },
      makeContext(tools),
    )

    // Only the deferred tool should be found via keyword search
    expect(result.data.resolvedMatches).toHaveLength(1)
    expect(result.data.resolvedMatches[0]!.tool.name).toBe('ReadMcp')
  })

  test('respects max_results limit', async () => {
    const tools = Array.from({ length: 10 }, (_, i) =>
      makeToolStub({ name: `mcp__server__tool${i}`, isMcp: true }),
    )

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'tool', max_results: 3 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(3)
  })

  test('no matches returns empty with total count', async () => {
    const tools = [
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'nonexistent', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.resolvedMatches).toHaveLength(0)
    expect(result.data.totalDeferred).toBe(1)
  })

  test('+term syntax requires term in name', async () => {
    const tools = [
      makeToolStub({ name: 'mcp__slack__send', isMcp: true }),
      makeToolStub({ name: 'mcp__slack__list', isMcp: true }),
      makeToolStub({ name: 'mcp__github__send', isMcp: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: '+slack send', max_results: 5 },
      makeContext(tools),
    )

    // Must contain "slack" AND rank by "send"
    expect(result.data.resolvedMatches.length).toBeGreaterThanOrEqual(1)
    expect(result.data.resolvedMatches[0]!.tool.name).toBe('mcp__slack__send')
    // github__send should NOT match (doesn't contain "slack")
    const names = result.data.resolvedMatches.map(m => m.tool.name)
    expect(names).not.toContain('mcp__github__send')
  })
})

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

describe('ToolSearch: result formatting', () => {
  test('formats results in <functions> block', async () => {
    const tools = [
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:WebFetch', max_results: 5 },
      makeContext(tools),
    )

    const block = tool.mapToolResultToToolResultBlockParam(result.data, 'test-id')
    expect(block.tool_use_id).toBe('test-id')
    const content = block.content as string
    expect(content).toContain('<functions>')
    expect(content).toContain('</functions>')
    expect(content).toContain('<function>')
    expect(content).toContain('"name":"WebFetch"')
    expect(content).toContain('"parameters"')
  })

  test('formats no-match result with helpful message', async () => {
    const tools = [
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'nonexistent', max_results: 5 },
      makeContext(tools),
    )

    const block = tool.mapToolResultToToolResultBlockParam(result.data, 'test-id')
    const content = block.content as string
    expect(content).toContain('No matching deferred tools')
    expect(content).toContain('1 deferred tools available')
  })

  test('includes JSON Schema in result for Zod-based tools', async () => {
    const tools = [
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:WebFetch', max_results: 5 },
      makeContext(tools),
    )

    const block = tool.mapToolResultToToolResultBlockParam(result.data, 'test-id')
    const content = block.content as string
    // Should contain the JSON schema properties (JSON.stringify, no spaces)
    expect(content).toContain('"type":"object"')
  })

  test('includes JSON Schema in result for MCP tools (raw JSON Schema)', async () => {
    const mcpTool = buildTool({
      name: 'mcp__server__action',
      isMcp: true,
      maxResultSizeChars: 10_000,
      inputSchema: z.record(z.string(), z.unknown()),
      inputJSONSchema: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
      },
      async call() { return { data: null } },
      async prompt() { return 'MCP action tool' },
      async description() { return 'action' },
      mapToolResultToToolResultBlockParam(_output, toolUseID) {
        return { type: 'tool_result' as const, tool_use_id: toolUseID, content: '' }
      },
    })

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:mcp__server__action', max_results: 5 },
      makeContext([mcpTool]),
    )

    const block = tool.mapToolResultToToolResultBlockParam(result.data, 'test-id')
    const content = block.content as string
    expect(content).toContain('"target"')
    expect(content).toContain('"type":"object"')
  })

  test('totalDeferred counts all deferred tools', async () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
      makeToolStub({ name: 'WebSearch', shouldDefer: true }),
      makeToolStub({ name: 'mcp__a', isMcp: true }),
    ]

    const tool = makeToolSearchTool()
    const result = await tool.call(
      { query: 'select:Read', max_results: 5 },
      makeContext(tools),
    )

    expect(result.data.totalDeferred).toBe(3)
  })
})
