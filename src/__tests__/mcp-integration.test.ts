import { describe, expect, test } from 'bun:test'
import { toApiTools } from '../services/tools/to-api-tools.js'
import { z } from 'zod'
import type { Tool } from '../services/tools/types.js'
import { buildTool } from '../services/tools/build-tool.js'

// ---------------------------------------------------------------------------
// toApiTools — JSON Schema passthrough for MCP tools
// ---------------------------------------------------------------------------

describe('toApiTools with inputJSONSchema', () => {
  function makeMcpTool(name: string, jsonSchema: Record<string, unknown>): Tool {
    return {
      name,
      inputSchema: z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>,
      inputJSONSchema: jsonSchema,
      isMcp: true,
      maxResultSizeChars: 100_000,
      isReadOnly: () => false,
      isConcurrencySafe: () => true,
      isEnabled: () => true,
      checkPermissions: () => Promise.resolve({ behavior: 'passthrough' as const }),
      userFacingName: () => name,
      async prompt() { return 'A test MCP tool' },
      async description() { return 'test' },
      async call() { return { data: 'ok' } },
      mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
        return { type: 'tool_result' as const, tool_use_id: toolUseID, content: String(output) }
      },
    } as Tool
  }

  test('uses inputJSONSchema directly instead of converting Zod', async () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        recursive: { type: 'boolean' },
      },
      required: ['path'],
    }

    const tools = await toApiTools([makeMcpTool('mcp__fs__read', jsonSchema)])
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('mcp__fs__read')
    expect(tools[0]!.input_schema).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        recursive: { type: 'boolean' },
      },
      required: ['path'],
    })
  })

  test('handles MCP tool with no properties', async () => {
    const jsonSchema = { type: 'object' }
    const tools = await toApiTools([makeMcpTool('mcp__fs__noop', jsonSchema)])
    expect(tools[0]!.input_schema).toEqual({ type: 'object' })
  })

  test('handles MCP tool with no required fields', async () => {
    const jsonSchema = {
      type: 'object',
      properties: { foo: { type: 'string' } },
    }
    const tools = await toApiTools([makeMcpTool('mcp__fs__optional', jsonSchema)])
    expect(tools[0]!.input_schema.required).toBeUndefined()
  })

  test('mixes built-in Zod tools with MCP JSON Schema tools', async () => {
    const builtinTool = buildTool({
      name: 'Echo',
      maxResultSizeChars: 10_000,
      get inputSchema() { return z.strictObject({ msg: z.string() }) },
      async call(input: { msg: string }) { return { data: input.msg } },
      async prompt() { return 'Echo' },
      async description() { return 'echo' },
      mapToolResultToToolResultBlockParam(output: string, id: string) {
        return { type: 'tool_result' as const, tool_use_id: id, content: output }
      },
    }) as Tool

    const mcpTool = makeMcpTool('mcp__test__tool', {
      type: 'object',
      properties: { x: { type: 'number' } },
    })

    const tools = await toApiTools([builtinTool, mcpTool])
    expect(tools).toHaveLength(2)
    // Built-in tool uses Zod conversion
    expect(tools[0]!.name).toBe('Echo')
    expect(tools[0]!.input_schema.properties).toHaveProperty('msg')
    // MCP tool uses JSON Schema passthrough
    expect(tools[1]!.name).toBe('mcp__test__tool')
    expect(tools[1]!.input_schema.properties).toHaveProperty('x')
  })
})
