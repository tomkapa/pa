import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  buildTool,
  isDeferredTool,
  getToolsForAPICall,
  buildDeferredToolsAnnouncement,
  type Tool,
  type ToolDef,
  type ToolUseContext,
} from '../services/tools/index.js'

// ---------------------------------------------------------------------------
// Helpers — minimal tool stubs
// ---------------------------------------------------------------------------

function makeToolStub(
  overrides: Partial<ToolDef<unknown, unknown>> & { name: string },
): Tool<unknown, unknown> {
  return buildTool({
    maxResultSizeChars: 10_000,
    get inputSchema() { return z.strictObject({}) },
    async call() { return { data: null } },
    async prompt() { return `${overrides.name} tool` },
    async description() { return overrides.name },
    mapToolResultToToolResultBlockParam(_output, toolUseID) {
      return { type: 'tool_result' as const, tool_use_id: toolUseID, content: '' }
    },
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// isDeferredTool
// ---------------------------------------------------------------------------

describe('isDeferredTool', () => {
  test('core tools (no flags) are NOT deferred', () => {
    const read = makeToolStub({ name: 'Read' })
    const write = makeToolStub({ name: 'Write' })
    const bash = makeToolStub({ name: 'Bash' })

    expect(isDeferredTool(read)).toBe(false)
    expect(isDeferredTool(write)).toBe(false)
    expect(isDeferredTool(bash)).toBe(false)
  })

  test('tools with shouldDefer=true ARE deferred', () => {
    const webFetch = makeToolStub({ name: 'WebFetch', shouldDefer: true })
    expect(isDeferredTool(webFetch)).toBe(true)
  })

  test('MCP tools are always deferred', () => {
    const mcpTool = makeToolStub({ name: 'mcp__slack__send', isMcp: true })
    expect(isDeferredTool(mcpTool)).toBe(true)
  })

  test('MCP tools with alwaysLoad=true are NOT deferred', () => {
    const mcpTool = makeToolStub({
      name: 'mcp__primary__action',
      isMcp: true,
      alwaysLoad: true,
    })
    expect(isDeferredTool(mcpTool)).toBe(false)
  })

  test('ToolSearch itself is never deferred', () => {
    const toolSearch = makeToolStub({ name: 'ToolSearch' })
    expect(isDeferredTool(toolSearch)).toBe(false)
  })

  test('alwaysLoad takes precedence over shouldDefer', () => {
    const tool = makeToolStub({
      name: 'Special',
      shouldDefer: true,
      alwaysLoad: true,
    })
    expect(isDeferredTool(tool)).toBe(false)
  })

  test('alwaysLoad takes precedence over isMcp', () => {
    const tool = makeToolStub({
      name: 'mcp__important',
      isMcp: true,
      alwaysLoad: true,
    })
    expect(isDeferredTool(tool)).toBe(false)
  })

  test('classification order: alwaysLoad > isMcp > name > shouldDefer > default', () => {
    // Default: not deferred
    expect(isDeferredTool(makeToolStub({ name: 'Plain' }))).toBe(false)

    // shouldDefer: deferred
    expect(isDeferredTool(makeToolStub({ name: 'Opt', shouldDefer: true }))).toBe(true)

    // ToolSearch name: not deferred even with shouldDefer
    expect(isDeferredTool(makeToolStub({ name: 'ToolSearch', shouldDefer: true }))).toBe(false)

    // isMcp: deferred regardless of shouldDefer
    expect(isDeferredTool(makeToolStub({ name: 'mcp__x', isMcp: true }))).toBe(true)

    // alwaysLoad: not deferred regardless of isMcp
    expect(isDeferredTool(makeToolStub({ name: 'mcp__x', isMcp: true, alwaysLoad: true }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getToolsForAPICall
// ---------------------------------------------------------------------------

describe('getToolsForAPICall', () => {
  test('returns only non-deferred tools when nothing discovered', () => {
    const read = makeToolStub({ name: 'Read' })
    const webFetch = makeToolStub({ name: 'WebFetch', shouldDefer: true })
    const mcpTool = makeToolStub({ name: 'mcp__a', isMcp: true })

    const result = getToolsForAPICall(
      [read, webFetch, mcpTool],
      new Set(),
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Read')
  })

  test('includes discovered deferred tools', () => {
    const read = makeToolStub({ name: 'Read' })
    const webFetch = makeToolStub({ name: 'WebFetch', shouldDefer: true })
    const mcpTool = makeToolStub({ name: 'mcp__a', isMcp: true })

    const result = getToolsForAPICall(
      [read, webFetch, mcpTool],
      new Set(['WebFetch']),
    )

    expect(result).toHaveLength(2)
    expect(result.map(t => t.name)).toContain('Read')
    expect(result.map(t => t.name)).toContain('WebFetch')
  })

  test('includes all tools when all are discovered', () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
      makeToolStub({ name: 'mcp__a', isMcp: true }),
    ]

    const result = getToolsForAPICall(
      tools,
      new Set(['WebFetch', 'mcp__a']),
    )

    expect(result).toHaveLength(3)
  })

  test('alwaysLoad MCP tools are included without discovery', () => {
    const mcpAlways = makeToolStub({
      name: 'mcp__primary',
      isMcp: true,
      alwaysLoad: true,
    })
    const mcpDeferred = makeToolStub({ name: 'mcp__other', isMcp: true })

    const result = getToolsForAPICall(
      [mcpAlways, mcpDeferred],
      new Set(),
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('mcp__primary')
  })
})

// ---------------------------------------------------------------------------
// buildDeferredToolsAnnouncement
// ---------------------------------------------------------------------------

describe('buildDeferredToolsAnnouncement', () => {
  test('returns null when no deferred tools exist', () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'Write' }),
    ]

    expect(buildDeferredToolsAnnouncement(tools, new Set())).toBeNull()
  })

  test('lists deferred tool names alphabetically', () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'WebSearch', shouldDefer: true }),
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
      makeToolStub({ name: 'mcp__slack', isMcp: true }),
    ]

    const announcement = buildDeferredToolsAnnouncement(tools, new Set())
    expect(announcement).not.toBeNull()
    expect(announcement).toContain('<system-reminder>')
    expect(announcement).toContain('</system-reminder>')
    expect(announcement).toContain('WebFetch')
    expect(announcement).toContain('WebSearch')
    expect(announcement).toContain('mcp__slack')
    // Check alphabetical order (default string sort: uppercase before lowercase)
    const idx = {
      fetch: announcement!.indexOf('WebFetch'),
      search: announcement!.indexOf('WebSearch'),
      slack: announcement!.indexOf('mcp__slack'),
    }
    expect(idx.fetch).toBeLessThan(idx.search)
    expect(idx.fetch).toBeLessThan(idx.slack) // 'W' < 'm' in ASCII
  })

  test('excludes already-discovered tools from announcement', () => {
    const tools = [
      makeToolStub({ name: 'WebSearch', shouldDefer: true }),
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
    ]

    const announcement = buildDeferredToolsAnnouncement(
      tools,
      new Set(['WebFetch']),
    )

    expect(announcement).not.toBeNull()
    expect(announcement).toContain('WebSearch')
    expect(announcement).not.toContain('WebFetch')
  })

  test('returns null when all deferred tools are already discovered', () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
    ]

    expect(buildDeferredToolsAnnouncement(tools, new Set(['WebFetch']))).toBeNull()
  })

  test('does not include non-deferred tools in announcement', () => {
    const tools = [
      makeToolStub({ name: 'Read' }),
      makeToolStub({ name: 'WebFetch', shouldDefer: true }),
    ]

    const announcement = buildDeferredToolsAnnouncement(tools, new Set())
    expect(announcement).not.toContain('Read')
    expect(announcement).toContain('WebFetch')
  })
})
