import { z } from 'zod'
import type { ToolDef, ToolUseContext, Tool } from '../services/tools/types.js'
import type { PermissionResult } from '../services/permissions/types.js'
import { buildTool } from '../services/tools/build-tool.js'

export function makeToolDef(
  overrides?: Partial<ToolDef<{ value: string }, string>> & {
    checkPermissions?: (
      input: { value: string },
      ctx: ToolUseContext,
    ) => Promise<PermissionResult>
  },
): ToolDef<{ value: string }, string> {
  return {
    name: 'TestTool',
    maxResultSizeChars: 50_000,
    inputSchema: z.strictObject({ value: z.string() }),
    async call(input) {
      return { data: input.value }
    },
    async prompt() {
      return 'A test tool.'
    },
    async description(input) {
      return `Test: ${input.value}`
    },
    mapToolResultToToolResultBlockParam(output, toolUseID) {
      return { type: 'tool_result' as const, tool_use_id: toolUseID, content: output }
    },
    ...overrides,
  }
}

/**
 * Create a minimal built Tool for testing tool filtering, resolution,
 * and agent dispatch logic. Unlike `makeToolDef` which returns a `ToolDef`,
 * this returns a fully built `Tool` (as returned by `buildTool`).
 */
export function makeFakeTool(name: string): Tool<Record<string, never>, { content: string }> {
  return buildTool({
    name,
    maxResultSizeChars: 1000,
    get inputSchema() {
      return z.strictObject({})
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async call() {
      return { data: { content: 'ok' } }
    },
    async prompt() { return `${name} tool` },
    async description() { return name },
    mapToolResultToToolResultBlockParam(output: { content: string }, id: string) {
      return { type: 'tool_result' as const, tool_use_id: id, content: output.content }
    },
  })
}

export function makeBashToolDef(
  overrides?: Partial<ToolDef<{ value: string }, string>>,
): ToolDef<{ value: string }, string> {
  return makeToolDef({
    name: 'Bash',
    userFacingName: (input) => input.value ? `Bash(${input.value})` : 'Bash',
    ...overrides,
  })
}
