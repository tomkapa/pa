import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  buildTool,
  findToolByName,
  getTools,
  type Tool,
  type ToolDef,
  type ToolResult,
  type ToolUseContext,
  type PermissionResult,
  type ValidationResult,
} from '../services/tools/index.js'

// ---------------------------------------------------------------------------
// Helpers — a minimal echo tool used across tests
// ---------------------------------------------------------------------------

function makeEchoToolDef(
  overrides?: Partial<ToolDef<{ message: string }, string>>,
): ToolDef<{ message: string }, string> {
  return {
    name: 'Echo',
    maxResultSizeChars: 10_000,
    get inputSchema() {
      return z.strictObject({ message: z.string() })
    },
    async call(input) {
      return { data: input.message }
    },
    async prompt() {
      return 'Echoes the input message back.'
    },
    async description(input) {
      return `Echo: ${input.message}`
    },
    userFacingName() {
      return 'Echo'
    },
    mapToolResultToToolResultBlockParam(output, toolUseID) {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: output,
      }
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildTool
// ---------------------------------------------------------------------------

describe('buildTool', () => {
  test('creates a tool with all required fields from definition', () => {
    const tool = buildTool(makeEchoToolDef())

    expect(tool.name).toBe('Echo')
    expect(tool.maxResultSizeChars).toBe(10_000)
    expect(typeof tool.call).toBe('function')
    expect(typeof tool.prompt).toBe('function')
    expect(typeof tool.description).toBe('function')
    expect(typeof tool.isReadOnly).toBe('function')
    expect(typeof tool.isConcurrencySafe).toBe('function')
    expect(typeof tool.isEnabled).toBe('function')
    expect(typeof tool.checkPermissions).toBe('function')
    expect(typeof tool.userFacingName).toBe('function')
    expect(typeof tool.mapToolResultToToolResultBlockParam).toBe('function')
  })

  test('applies fail-closed defaults for safety metadata', () => {
    const tool = buildTool(makeEchoToolDef())

    // Fail-closed: assume writes, not concurrency-safe
    expect(tool.isReadOnly({ message: 'test' })).toBe(false)
    expect(tool.isConcurrencySafe({ message: 'test' })).toBe(false)
    expect(tool.isEnabled()).toBe(true)
  })

  test('allows overriding safety defaults', () => {
    const tool = buildTool(makeEchoToolDef({
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      isEnabled: () => false,
    }))

    expect(tool.isReadOnly({ message: 'test' })).toBe(true)
    expect(tool.isConcurrencySafe({ message: 'test' })).toBe(true)
    expect(tool.isEnabled()).toBe(false)
  })

  test('default checkPermissions returns passthrough', async () => {
    const tool = buildTool(makeEchoToolDef())
    const input = { message: 'hello' }
    const result = await tool.checkPermissions(input, {} as ToolUseContext)

    expect(result).toEqual({ behavior: 'passthrough' })
  })

  test('default userFacingName returns the tool name', () => {
    const def = makeEchoToolDef()
    // Delete the custom userFacingName so buildTool's default applies
    delete (def as unknown as Record<string, unknown>).userFacingName
    const tool = buildTool(def)

    expect(tool.userFacingName({})).toBe('Echo')
  })

  test('tool call executes and returns ToolResult', async () => {
    const tool = buildTool(makeEchoToolDef())
    const result = await tool.call({ message: 'hello world' }, {} as ToolUseContext)

    expect(result.data).toBe('hello world')
  })

  test('tool result can include newMessages', async () => {
    const tool = buildTool(makeEchoToolDef({
      async call(input) {
        return {
          data: input.message,
          newMessages: [],
        }
      },
    }))

    const result = await tool.call({ message: 'test' }, {} as ToolUseContext)
    expect(result.newMessages).toEqual([])
  })

  test('tool result can include contextModifier', async () => {
    const modifier = (ctx: ToolUseContext) => ctx
    const tool = buildTool(makeEchoToolDef({
      async call(input) {
        return {
          data: input.message,
          contextModifier: modifier,
        }
      },
    }))

    const result = await tool.call({ message: 'test' }, {} as ToolUseContext)
    expect(result.contextModifier).toBe(modifier)
  })

  test('validates input with Zod schema', () => {
    const tool = buildTool(makeEchoToolDef())
    const schema = tool.inputSchema

    const valid = schema.safeParse({ message: 'hello' })
    expect(valid.success).toBe(true)

    const invalid = schema.safeParse({ message: 123 })
    expect(invalid.success).toBe(false)

    // strictObject rejects extra fields
    const extra = schema.safeParse({ message: 'hello', extra: true })
    expect(extra.success).toBe(false)
  })

  test('optional validateInput can be provided', async () => {
    const tool = buildTool(makeEchoToolDef({
      async validateInput(input) {
        if (input.message === '') {
          return { result: false, message: 'Message cannot be empty' }
        }
        return { result: true }
      },
    }))

    expect(tool.validateInput).toBeDefined()
    const invalid = await tool.validateInput!({ message: '' }, {} as ToolUseContext)
    expect(invalid).toEqual({ result: false, message: 'Message cannot be empty' })

    const valid = await tool.validateInput!({ message: 'hello' }, {} as ToolUseContext)
    expect(valid).toEqual({ result: true })
  })

  test('tool without validateInput has undefined validateInput', () => {
    const tool = buildTool(makeEchoToolDef())
    expect(tool.validateInput).toBeUndefined()
  })

  test('mapToolResultToToolResultBlockParam formats correctly', () => {
    const tool = buildTool(makeEchoToolDef())
    const block = tool.mapToolResultToToolResultBlockParam('hello', 'tool-123')

    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'tool-123',
      content: 'hello',
    })
  })

  test('prompt returns description string', async () => {
    const tool = buildTool(makeEchoToolDef())
    const prompt = await tool.prompt()
    expect(prompt).toBe('Echoes the input message back.')
  })

  test('description returns input-specific description', async () => {
    const tool = buildTool(makeEchoToolDef())
    const desc = await tool.description({ message: 'hi' })
    expect(desc).toBe('Echo: hi')
  })

  test('custom checkPermissions override works', async () => {
    const tool = buildTool(makeEchoToolDef({
      async checkPermissions(input) {
        if (input.message.includes('dangerous')) {
          return {
            behavior: 'deny' as const,
            reason: { type: 'toolSpecific' as const, description: 'Dangerous content' },
            message: 'Dangerous content',
          }
        }
        return { behavior: 'allow' as const, updatedInput: input }
      },
    }))

    const allowed = await tool.checkPermissions({ message: 'safe' }, {} as ToolUseContext)
    expect(allowed.behavior).toBe('allow')

    const denied = await tool.checkPermissions({ message: 'dangerous' }, {} as ToolUseContext)
    expect(denied.behavior).toBe('deny')
  })
})

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

describe('getTools', () => {
  test('returns all enabled tools', () => {
    const enabledTool = buildTool(makeEchoToolDef({ name: 'Enabled' }))
    const disabledTool = buildTool(makeEchoToolDef({
      name: 'Disabled',
      isEnabled: () => false,
    }))

    const tools = getTools([enabledTool, disabledTool])
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('Enabled')
  })

  test('returns empty array when no tools are enabled', () => {
    const disabled = buildTool(makeEchoToolDef({ isEnabled: () => false }))
    expect(getTools([disabled])).toHaveLength(0)
  })

  test('returns all tools when all are enabled', () => {
    const a = buildTool(makeEchoToolDef({ name: 'A' }))
    const b = buildTool(makeEchoToolDef({ name: 'B' }))
    expect(getTools([a, b])).toHaveLength(2)
  })
})

describe('findToolByName', () => {
  test('finds a tool by exact name match', () => {
    const echo = buildTool(makeEchoToolDef())
    const tools = [echo]

    expect(findToolByName(tools, 'Echo')).toBe(echo)
  })

  test('returns undefined for non-existent tool', () => {
    const echo = buildTool(makeEchoToolDef())
    expect(findToolByName([echo], 'NonExistent')).toBeUndefined()
  })

  test('returns undefined for empty tools list', () => {
    expect(findToolByName([], 'Echo')).toBeUndefined()
  })

  test('is case-sensitive', () => {
    const echo = buildTool(makeEchoToolDef())
    expect(findToolByName([echo], 'echo')).toBeUndefined()
    expect(findToolByName([echo], 'ECHO')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Type-level checks (compile-time assertions, not runtime tests)
// ---------------------------------------------------------------------------

describe('type contracts', () => {
  test('ToolResult shape is correct', () => {
    const result: ToolResult<string> = {
      data: 'hello',
    }
    expect(result.data).toBe('hello')
    expect(result.newMessages).toBeUndefined()
    expect(result.contextModifier).toBeUndefined()
  })

  test('PermissionResult allow shape', () => {
    const allow: PermissionResult = {
      behavior: 'allow',
      updatedInput: { foo: 'bar' },
    }
    expect(allow.behavior).toBe('allow')
  })

  test('PermissionResult deny shape', () => {
    const deny: PermissionResult = {
      behavior: 'deny',
      reason: { type: 'toolSpecific', description: 'Not allowed' },
      message: 'Not allowed',
    }
    expect(deny.behavior).toBe('deny')
    if (deny.behavior === 'deny') {
      expect(deny.message).toBe('Not allowed')
    }
  })

  test('PermissionResult ask shape', () => {
    const ask: PermissionResult = {
      behavior: 'ask',
      reason: { type: 'default' },
      message: 'Should I proceed?',
    }
    expect(ask.behavior).toBe('ask')
  })

  test('PermissionResult passthrough shape', () => {
    const passthrough: PermissionResult = {
      behavior: 'passthrough',
    }
    expect(passthrough.behavior).toBe('passthrough')
  })

  test('ValidationResult success shape', () => {
    const success: ValidationResult = { result: true }
    expect(success.result).toBe(true)
  })

  test('ValidationResult failure shape', () => {
    const failure: ValidationResult = { result: false, message: 'Invalid' }
    expect(failure.result).toBe(false)
    expect(failure.message).toBe('Invalid')
  })
})
